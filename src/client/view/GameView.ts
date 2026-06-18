import { Config } from "../../core/configuration/Config";
import {
  Cell,
  GameUpdates,
  PlayerID,
  TerrainType,
  TerraNullius,
  Tick,
  Unit,
  UnitInfo,
  UnitType,
} from "../../core/game/Game";
import { GameMap, TileRef } from "../../core/game/GameMap";
import {
  GameUpdateType,
  GameUpdateViewData,
  SpawnPhaseEndUpdate,
} from "../../core/game/GameUpdates";
import { ATTACK_DELTA_OUTGOING } from "../../core/game/GameUpdateUtils";
import {
  MotionPlanRecord,
  unpackMotionPlans,
} from "../../core/game/MotionPlans";
import { TerrainMapData } from "../../core/game/TerrainMapLoader";
import { TerraNulliusImpl } from "../../core/game/TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "../../core/game/UnitGrid";
import { ClientID, GameID, Player, PlayerCosmetics } from "../../core/Schemas";
import { formatPlayerDisplayName } from "../../core/Util";
import { WorkerClient } from "../../core/worker/WorkerClient";
import { computeAllianceClusters } from "../render/frame/derive/AllianceClusters";
import { extractAttackRings } from "../render/frame/derive/AttackRings";
import { extractNukeTelegraphs } from "../render/frame/derive/NukeTelegraphs";
import { computePlayerStatus } from "../render/frame/derive/PlayerStatus";
import { buildRelationMatrix } from "../render/frame/derive/RelationMatrix";
import { RailroadCache } from "../render/frame/RailroadCache";
import { TrailManager } from "../render/frame/TrailManager";
import type { FrameData, NameEntry, TilePair } from "../render/types";
import { STRUCTURE_TYPES } from "../render/types";
import { PlayerView } from "./PlayerView";
import { UnitView } from "./UnitView";

const TRAIL_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.TransportShip,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.MIRVWarhead,
]);

type TrainPlanState = {
  planId: number;
  startTick: number;
  speed: number;
  spacing: number;
  carUnitIds: Uint32Array;
  path: Uint32Array;
  cursor: number;
  usedTilesBuf: Uint32Array;
  usedHead: number;
  usedLen: number;
  lastAdvancedTick: Tick;
};

export class GameView implements GameMap {
  private lastUpdate: GameUpdateViewData | null;
  private startTick: Tick | null = null;
  private smallIDToID = new Map<number, PlayerID>();
  private _players = new Map<PlayerID, PlayerView>();
  private _units = new Map<number, UnitView>();
  /**
   * Long-lived state maps (renderer's plain-object shape). Each entry shares
   * its identity with the corresponding PlayerView.state / UnitView.state, so
   * mutations through either path are visible everywhere.
   */
  private _playerStates = new Map<
    number,
    import("../render/types").PlayerState
  >();
  private _unitStates = new Map<number, import("../render/types").UnitState>();
  /** smallID → team, for the renderer's relation matrix (team games). */
  private _teams = new Map<number, string>();
  private updatedTiles: TileRef[] = [];
  private updatedTerrainTiles: TileRef[] = [];

  // ── FrameData accumulators (renderer-bound state) ─────────────────────
  private trailManager!: TrailManager;
  private railroadCache!: RailroadCache;
  /** Long-lived NameEntry map for the renderer's NamePass. */
  private _names = new Map<string, NameEntry>();
  /** Reusable scratch buffers for per-tick deltas. */
  private readonly _changedTilesScratch: TilePair[] = [];
  private readonly _trailIdsScratch: number[] = [];
  /**
   * The single long-lived FrameData object. Fields are mutated in place each
   * tick by update(). Renderer reads this each frame via frameData().
   */
  private _frame: FrameData;
  private _structuresDirty = false;
  /** True until first populateFrame() — controls full-vs-delta tile upload. */
  private _firstPopulate = true;

  private _myPlayer: PlayerView | null = null;

  // ── populateFrame dirty flags ──────────────────────────────────────────
  // The derived structures below only depend on rarely-changing player
  // fields, so they're rebuilt only when one of their inputs arrived this
  // tick (PlayerUpdates are partial — field presence means "changed").
  /** Names: nameData record applied, or a player was added. */
  private _namesDirty = true;
  /** Relation matrix: allies/embargoes changed, or a player was added. */
  private _relationsDirty = true;
  /** Alliance clusters: allies changed, or a player was added. */
  private _clustersDirty = true;

  private unitGrid: UnitGrid;
  private unitMotionPlans = new Map<
    number,
    {
      planId: number;
      startTick: number;
      ticksPerStep: number;
      path: Uint32Array;
    }
  >();
  private trainMotionPlans = new Map<number, TrainPlanState>();
  private trainUnitToEngine = new Map<number, number>();

  private toDelete = new Set<number>();

  private _cosmetics: Map<string, PlayerCosmetics> = new Map();

  private _map: GameMap;

  constructor(
    public worker: WorkerClient,
    private _config: Config,
    private _mapData: TerrainMapData,
    private _myClientID: ClientID | undefined,
    private _myUsername: string,
    private _myClanTag: string | null,
    private _gameID: GameID,
    humans: Player[],
  ) {
    this._map = this._mapData.gameMap;
    this.lastUpdate = null;
    this.unitGrid = new UnitGrid(this._map);
    this._cosmetics = new Map(
      humans.map((h) => [h.clientID, h.cosmetics ?? {}]),
    );
    for (const nation of this._mapData.nations) {
      // Nations don't have client ids, so we use their name as the key instead.
      this._cosmetics.set(nation.name, {
        flag: nation.flag ? `/flags/${nation.flag}.svg` : undefined,
      } satisfies PlayerCosmetics);
    }
    for (const extra of this._mapData.additionalNations) {
      // Only set if not already provided by a manifest nation with the same name.
      if (this._cosmetics.has(extra.name)) continue;
      this._cosmetics.set(extra.name, {
        flag: extra.flag ? `/flags/${extra.flag}.svg` : undefined,
      } satisfies PlayerCosmetics);
    }

    const mapW = this._map.width();
    const mapH = this._map.height();
    this.trailManager = new TrailManager(mapW, mapH);
    this.railroadCache = new RailroadCache(mapW, mapH);

    // Long-lived FrameData. Most fields are mutable references to long-lived
    // buffers (tileState, trailState, etc.); some (_changedTilesScratch,
    // derived arrays) are reused each tick. Properties marked `readonly` on
    // FrameData only prevent reassignment, not mutation through the reference.
    // events: fresh arrays we own; cleared and repopulated each tick.
    this._frame = {
      tick: 0,
      inSpawnPhase: true,
      tileState: this._map.tileStateBuffer(),
      trailState: this.trailManager.getTrailState(),
      railroadState: this.railroadCache.railroadState,
      units: this._unitStates,
      players: this._playerStates,
      names: this._names,
      events: {
        deadUnits: [],
        conquestEvents: [],
        bonusEvents: [],
      },
      changedTiles: this._changedTilesScratch,
      railroadDirty: false,
      revealedRailTiles: this.railroadCache.revealedRailTiles,
      trailDirtyRowMin: 0,
      trailDirtyRowMax: -1,
      // Derived data — populated each tick by populateFrame(). Empty defaults
      // here so the type is satisfied before the first update().
      playerStatus: new Map(),
      relationMatrix: new Uint8Array(0),
      relationSize: 0,
      relationsDirty: false,
      allianceClusters: new Map(),
      nukeTelegraphs: [],
      attackRings: [],
      structuresDirty: false,
    };
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  public updatesSinceLastTick(): GameUpdates | null {
    return this.lastUpdate?.updates ?? null;
  }

  public motionPlans(): ReadonlyMap<
    number,
    {
      planId: number;
      startTick: number;
      ticksPerStep: number;
      path: Uint32Array;
    }
  > {
    return this.unitMotionPlans;
  }

  private motionPlannedUnitIdsCache: number[] = [];
  private motionPlannedUnitIdsDirty = true;

  private markMotionPlannedUnitIdsDirty(): void {
    this.motionPlannedUnitIdsDirty = true;
  }

  private rebuildMotionPlannedUnitIdsCacheIfDirty(): void {
    if (!this.motionPlannedUnitIdsDirty) {
      return;
    }
    this.motionPlannedUnitIdsDirty = false;

    const out = this.motionPlannedUnitIdsCache;
    out.length = 0;

    for (const unitId of this.unitMotionPlans.keys()) {
      out.push(unitId);
    }
    for (const [engineId, plan] of this.trainMotionPlans) {
      out.push(engineId);
      for (let i = 0; i < plan.carUnitIds.length; i++) {
        const id = plan.carUnitIds[i] >>> 0;
        if (id !== 0) out.push(id);
      }
    }
  }

  public motionPlannedUnitIds(): number[] {
    this.rebuildMotionPlannedUnitIdsCacheIfDirty();
    return this.motionPlannedUnitIdsCache;
  }

  public isCatchingUp(): boolean {
    return (this.lastUpdate?.pendingTurns ?? 0) > 1;
  }

  public update(gu: GameUpdateViewData) {
    this.toDelete.forEach((id) => {
      this._units.delete(id);
      this._unitStates.delete(id);
    });
    this.toDelete.clear();

    this.lastUpdate = gu;

    this.updatedTiles = [];
    this.updatedTerrainTiles = [];
    const packed = this.lastUpdate.packedTileUpdates;
    for (let i = 0; i + 1 < packed.length; i += 2) {
      const tile = packed[i];
      const state = packed[i + 1];
      const terrainChanged = this.updateTile(tile, state);
      this.updatedTiles.push(tile);
      if (terrainChanged) {
        this.updatedTerrainTiles.push(tile);
      }
    }

    if (gu.packedMotionPlans) {
      const records = unpackMotionPlans(gu.packedMotionPlans);
      this.applyMotionPlanRecords(records);
    }

    if (gu.updates === null) {
      throw new Error("lastUpdate.updates not initialized");
    }

    const spawnPhaseEndUpdate = gu.updates[GameUpdateType.SpawnPhaseEnd][0] as
      | SpawnPhaseEndUpdate
      | undefined;
    if (spawnPhaseEndUpdate) {
      this.startTick = spawnPhaseEndUpdate.startTick;
    }

    const myDisplayName = formatPlayerDisplayName(
      this._myUsername,
      this._myClanTag,
    );

    // Name placements arrive only on ticks where the worker recomputed them
    // (see GameUpdateViewData.playerNameViewData). Apply to existing alive
    // players here; dead players keep their last placement (names freeze at
    // death), and new players get theirs via the PlayerView constructor in
    // pass 1 below.
    if (gu.playerNameViewData !== undefined) {
      for (const id in gu.playerNameViewData) {
        const pv = this._players.get(id);
        if (pv !== undefined && pv.state.isAlive) {
          pv.nameData = gu.playerNameViewData[id];
        }
      }
      this._namesDirty = true;
    }

    // Pass 1: ensure every player exists with up-to-date PlayerState. We need
    // all smallIDs registered before pass 2 can translate embargo PlayerIDs.
    // PlayerUpdate is now partial: only `id` is guaranteed; everything else
    // is present only when its value changed since the last emission.
    gu.updates[GameUpdateType.Player].forEach((pu) => {
      // First-emission (new player) — must have all static fields populated.
      // Subsequent emissions for an existing player carry only changed fields.
      const existing = this._players.get(pu.id);

      // Replace the local player's name/displayName with their own stored values.
      // This way the user does not know they are being censored. clientID is
      // static — present only on first emission — so this branch only runs once.
      if (pu.clientID !== undefined && pu.clientID === this._myClientID) {
        pu.name = this._myUsername;
        pu.displayName = myDisplayName;
      }

      if (pu.smallID !== undefined) {
        this.smallIDToID.set(pu.smallID, pu.id);
      }

      // Derived-data dirty tracking: field presence on a partial update
      // means the field changed this tick.
      if (pu.allies !== undefined) {
        this._relationsDirty = true;
        this._clustersDirty = true;
      }
      if (pu.embargoes !== undefined) {
        this._relationsDirty = true;
      }

      if (existing !== undefined) {
        existing.applyUpdate(pu);
        const nextNameData = gu.playerNameViewData?.[pu.id];
        if (nextNameData !== undefined) {
          existing.nameData = nextNameData;
        }
      } else {
        const player = new PlayerView(
          this,
          pu,
          gu.playerNameViewData?.[pu.id],
          // First check human by clientID, then check nation by name.
          this._cosmetics.get(pu.clientID ?? "") ??
            this._cosmetics.get(pu.name!) ??
            {},
        );
        this._players.set(pu.id, player);
        this._playerStates.set(pu.smallID!, player.state);
        const team = player.team();
        if (team !== null) {
          this._teams.set(pu.smallID!, team);
        }
        this._namesDirty = true;
        this._relationsDirty = true;
        this._clustersDirty = true;
      }
    });

    // Pass 2: translate engine embargoes (Set<PlayerID>) → renderer-format
    // smallIDs. Only re-translate when embargoes changed (field present);
    // unchanged sets stay at the previously-computed renderer-format list.
    gu.updates[GameUpdateType.Player].forEach((pu) => {
      if (pu.embargoes === undefined) return;
      const player = this._players.get(pu.id);
      if (player === undefined) return;
      const smallIDs: number[] = [];
      for (const otherPlayerID of pu.embargoes) {
        const otherPV = this._players.get(otherPlayerID);
        if (otherPV !== undefined) {
          smallIDs.push(otherPV.smallID());
        }
      }
      player.setEmbargoSmallIDs(smallIDs);
    });

    // Packed per-player stats: [smallID, tilesOwned, gold, troops] quads for
    // every player whose stats changed this tick (the per-tick churn that no
    // longer travels in PlayerUpdate objects). Applied after pass 1 so
    // first-emission players exist; their quad carries the same values as
    // the full update, so double-applying is harmless.
    const packedStats = gu.packedPlayerUpdates;
    if (packedStats !== undefined) {
      for (let i = 0; i + 3 < packedStats.length; i += 4) {
        const state = this._playerStates.get(packedStats[i]);
        if (state === undefined) continue;
        state.tilesOwned = packedStats[i + 1];
        state.gold = packedStats[i + 2];
        state.troops = packedStats[i + 3];
      }
    }

    // Packed attack troop counts: [ownerSmallID, direction, index, troops]
    // quads. The attack arrays themselves are only resent when membership/
    // order changes, which is also what keeps these indexes valid — a tick
    // either resends an array (fresh troops included) or patches it, never
    // both. See packAttackTroopDeltas.
    const packedAttacks = gu.packedAttackUpdates;
    if (packedAttacks !== undefined) {
      for (let i = 0; i + 3 < packedAttacks.length; i += 4) {
        const state = this._playerStates.get(packedAttacks[i]);
        if (state === undefined) continue;
        const attacks =
          packedAttacks[i + 1] === ATTACK_DELTA_OUTGOING
            ? state.outgoingAttacks
            : state.incomingAttacks;
        const attack = attacks[packedAttacks[i + 2]];
        if (attack !== undefined) {
          attack.troops = packedAttacks[i + 3];
        }
      }
    }

    if (this._myClientID) {
      this._myPlayer ??= this.playerByClientID(this._myClientID);
    }

    for (const unit of this._units.values()) {
      unit._wasUpdated = false;
      unit.lastPos = unit.lastPos.slice(-1);
    }
    gu.updates[GameUpdateType.Unit].forEach((update) => {
      let unit = this._units.get(update.id);
      const isStructure = STRUCTURE_TYPES.has(update.unitType);
      if (unit !== undefined) {
        // Structure changes that affect rendering: owner changed (captured),
        // level changed, became inactive, or finished construction
        // (underConstruction → !underConstruction).
        if (
          isStructure &&
          (unit.state.ownerID !== update.ownerID ||
            unit.state.level !== update.level ||
            unit.state.isActive !== update.isActive ||
            (unit.state.underConstruction &&
              !(update.underConstruction ?? false)))
        ) {
          this._structuresDirty = true;
        }
        unit.update(update);
      } else {
        unit = new UnitView(this, update);
        this._units.set(update.id, unit);
        this._unitStates.set(update.id, unit.state);
        this.unitGrid.addUnit(unit);
        if (isStructure) this._structuresDirty = true;
      }
      if (!update.isActive) {
        this.unitGrid.removeUnit(unit);
      } else if (unit.tile() !== unit.lastTile()) {
        this.unitGrid.updateUnitCell(unit);
      }
      if (!unit.isActive()) {
        // Wait until next tick to delete the unit.
        this.toDelete.add(unit.id());
        if (this.unitMotionPlans.delete(unit.id())) {
          this.markMotionPlannedUnitIdsDirty();
        }
        this.clearTrainPlanForUnit(unit.id());
      }
    });

    this.advanceMotionPlannedUnits(gu.tick);
    this.rebuildMotionPlannedUnitIdsCacheIfDirty();

    this.populateFrame(gu);
  }

  // ── FrameData population ────────────────────────────────────────────────

  /**
   * Populate the long-lived FrameData from this tick's updates and current
   * state. Runs at the end of update() once all engine-driven mutations are
   * complete. Mutates _frame fields in place; never reassigns them.
   */
  private populateFrame(gu: GameUpdateViewData): void {
    // Reset trail dirty markers for this tick. The trailManager.update() pass
    // below repaints rows and re-sets these as it goes.
    this.trailManager.clearDirtyRows();

    // Railroad events accumulate into the cache; revealedRailTiles is cleared
    // at the start of apply().
    this.railroadCache.apply(gu);

    // Trail update: walk active trail-type units and stamp/decay.
    this._trailIdsScratch.length = 0;
    for (const u of this._units.values()) {
      if (u.isActive() && TRAIL_TYPES.has(u.type())) {
        this._trailIdsScratch.push(u.id());
      }
    }
    this.trailManager.update(
      this._unitStates as Map<number, import("../render/types").UnitState>,
      this._trailIdsScratch,
    );

    // Changed-tile delta refs (zero-copy: state field unused in live mode).
    this._changedTilesScratch.length = 0;
    for (let i = 0; i < this.updatedTiles.length; i++) {
      this._changedTilesScratch.push({ ref: this.updatedTiles[i], state: 0 });
    }

    // Names map — rebuilt only when a placement record arrived or a player
    // was added (nameData values cannot change between those ticks). Entry
    // order is irrelevant for the renderer.
    if (this._namesDirty) {
      this._namesDirty = false;
      this._names.clear();
      for (const p of this._players.values()) {
        this._names.set(p.id(), {
          playerID: p.id(),
          x: p.nameData?.x ?? 0,
          y: p.nameData?.y ?? 0,
          size: p.nameData?.size ?? 0,
        });
      }
    }

    // FrameEvents — clear arrays, then re-populate from this tick's updates.
    this.buildFrameEvents(gu);

    // Update FrameData fields. Derived data is computed once per tick and
    // stored directly on _frame (no intermediate copy). The renderer's
    // `readonly` modifier on FrameData is just an external API hint —
    // not enforced at runtime; we cast off to assign here.
    const f = this._frame as {
      -readonly [K in keyof FrameData]: FrameData[K];
    };
    f.tick = gu.tick;
    f.inSpawnPhase = this.startTick === null;
    f.railroadDirty = this.railroadCache.railroadDirty;
    f.trailDirtyRowMin = this.trailManager.dirtyRowMin;
    f.trailDirtyRowMax = this.trailManager.dirtyRowMax;

    f.playerStatus = computePlayerStatus(this._playerStates, this._unitStates, {
      localPlayerSmallID: this._myPlayer?.smallID() ?? 0,
      localPlayerID: this._myPlayer?.id() ?? "",
      tileState: this._map.tileStateBuffer(),
      tick: gu.tick,
      allianceDuration: this._config.allianceDuration(),
      isTransitiveTarget: (sid) =>
        this._myPlayer?.hasTransitiveTarget(sid) ?? false,
    });
    // Relations + clusters depend only on allies/embargoes/teams, which
    // change rarely (teams only when a player is added) — recompute only
    // when one of those inputs arrived this tick. buildRelationMatrix
    // writes into a reusable module-level buffer, so skipping the call
    // leaves f.relationMatrix's contents intact. f.relationsDirty lets the
    // upload layer skip the GPU push (and the full-map border recompute it
    // triggers) on unchanged ticks.
    if (this._relationsDirty) {
      this._relationsDirty = false;
      const rel = buildRelationMatrix(this._playerStates, this._teams);
      f.relationMatrix = rel.matrix;
      f.relationSize = rel.size;
      f.relationsDirty = true;
    } else {
      f.relationsDirty = false;
    }
    if (this._clustersDirty) {
      this._clustersDirty = false;
      f.allianceClusters = computeAllianceClusters(this._playerStates);
    }
    f.nukeTelegraphs = extractNukeTelegraphs(
      this._unitStates,
      this._map.width(),
      this._myPlayer?.smallID() ?? 0,
      // The latest relation matrix — recomputed above when dirty, otherwise
      // carried over on the frame from the last rebuild.
      f.relationMatrix,
      f.relationSize,
    );
    f.attackRings = this._myPlayer
      ? extractAttackRings(
          this._unitStates,
          this._map.width(),
          this._myPlayer.smallID(),
        )
      : [];
    f.structuresDirty = this._structuresDirty;

    // First populate: signal "full upload required" by nulling changedTiles.
    // uploadFrameData() treats null as "no delta info; do a full tile+trail
    // upload" — needed because the renderer's GPU buffers are empty.
    if (this._firstPopulate) {
      f.changedTiles = null;
      f.structuresDirty = true; // force initial structure upload
      this._firstPopulate = false;
    } else {
      f.changedTiles = this._changedTilesScratch;
    }

    // Reset transient flags for next tick.
    this.railroadCache.clearDirty();
    this._structuresDirty = false;
  }

  /** Clear and repopulate _frame.events arrays from this tick's gu.updates. */
  private buildFrameEvents(gu: GameUpdateViewData): void {
    const ev = this._frame.events;
    ev.deadUnits.length = 0;
    ev.conquestEvents.length = 0;
    ev.bonusEvents.length = 0;

    for (const u of gu.updates[GameUpdateType.Unit] ?? []) {
      if (u.isActive) continue;
      ev.deadUnits.push({
        unitType: u.unitType,
        pos: u.pos,
        reachedTarget: u.reachedTarget,
      });
    }
    const myID = this._myPlayer?.id();
    for (const c of gu.updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId !== myID) continue;
      const conquered = this._players.get(c.conqueredId);
      if (conquered === undefined) continue;
      const loc = conquered.nameLocation();
      if (loc === undefined) continue;
      ev.conquestEvents.push({
        x: loc.x,
        y: loc.y,
        gold: Number(c.gold),
      });
    }
    for (const b of gu.updates[GameUpdateType.BonusEvent] ?? []) {
      const player = this._players.get(b.player);
      if (player === undefined) continue;
      ev.bonusEvents.push({
        playerID: b.player,
        smallID: player.smallID(),
        tile: b.tile,
        gold: Number(b.gold),
        troops: b.troops,
      });
    }
  }

  /** Public accessor: the renderer reads this and uploads to the GPU. */
  frameData(): FrameData {
    return this._frame;
  }

  private advanceMotionPlannedUnits(currentTick: Tick): void {
    for (const [unitId, plan] of this.unitMotionPlans) {
      const unit = this._units.get(unitId);
      if (!unit || !unit.isActive()) {
        if (this.unitMotionPlans.delete(unitId)) {
          this.markMotionPlannedUnitIdsDirty();
        }
        continue;
      }

      const oldTile = unit.tile();
      const dt = currentTick - plan.startTick;
      const stepIndex =
        dt <= 0 ? 0 : Math.floor(dt / Math.max(1, plan.ticksPerStep));
      const lastIndex = plan.path.length - 1;
      const idx = Math.max(0, Math.min(lastIndex, stepIndex));
      const newTile = plan.path[idx] as TileRef;

      if (newTile !== oldTile) {
        unit.applyDerivedPosition(newTile);
        this.unitGrid.updateUnitCell(unit);
        continue;
      }

      unit.applyDerivedRest();

      // Once a plan is past its final step, `newTile` remains clamped to the last path tile.
      // Drop finished plans to avoid repeatedly marking static units as updated each tick.
      if (dt > 0 && stepIndex >= lastIndex) {
        if (this.unitMotionPlans.delete(unitId)) {
          this.markMotionPlannedUnitIdsDirty();
        }
      }
    }

    this.advanceTrainMotionPlannedUnits(currentTick);
  }

  private clearTrainPlanForUnit(unitId: number): void {
    const engineId =
      this.trainUnitToEngine.get(unitId) ??
      (this.trainMotionPlans.has(unitId) ? unitId : null);
    if (engineId === null) {
      return;
    }
    const plan = this.trainMotionPlans.get(engineId);
    if (!plan) {
      this.trainUnitToEngine.delete(unitId);
      return;
    }
    if (this.trainMotionPlans.delete(engineId)) {
      this.markMotionPlannedUnitIdsDirty();
    }
    this.trainUnitToEngine.delete(engineId);
    for (let i = 0; i < plan.carUnitIds.length; i++) {
      const id = plan.carUnitIds[i] >>> 0;
      if (id !== 0) this.trainUnitToEngine.delete(id);
    }
  }

  private advanceTrainMotionPlannedUnits(currentTick: Tick): void {
    const staleEngineIds: number[] = [];
    for (const [engineId, plan] of this.trainMotionPlans) {
      const engine = this._units.get(engineId);
      if (!engine || !engine.isActive()) {
        staleEngineIds.push(engineId);
        continue;
      }

      const steps = currentTick - plan.lastAdvancedTick;
      if (steps <= 0) {
        continue;
      }

      const path = plan.path;
      const lastIndex = path.length - 1;
      const cap = plan.usedTilesBuf.length;

      const pushUsed = (tile: TileRef) => {
        if (cap === 0) return;
        if (plan.usedLen < cap) {
          const idx = (plan.usedHead + plan.usedLen) % cap;
          plan.usedTilesBuf[idx] = tile >>> 0;
          plan.usedLen++;
        } else {
          plan.usedTilesBuf[plan.usedHead] = tile >>> 0;
          plan.usedHead = (plan.usedHead + 1) % cap;
          plan.usedLen = cap;
        }
      };

      const usedGet = (index: number): TileRef | null => {
        if (index < 0 || index >= plan.usedLen || cap === 0) return null;
        const idx = (plan.usedHead + index) % cap;
        return plan.usedTilesBuf[idx] as TileRef;
      };

      let didMove = false;
      for (let step = 0; step < steps; step++) {
        const cursor = plan.cursor;
        if (cursor >= lastIndex) {
          break;
        }
        for (let i = 0; i < plan.speed && cursor + i < path.length; i++) {
          pushUsed(path[cursor + i] as TileRef);
        }

        plan.cursor = Math.min(lastIndex, cursor + plan.speed);

        for (let i = plan.carUnitIds.length - 1; i >= 0; --i) {
          const carId = plan.carUnitIds[i] >>> 0;
          if (carId === 0) continue;
          const car = this._units.get(carId);
          if (!car || !car.isActive()) {
            continue;
          }
          const carTileIndex = (i + 1) * plan.spacing + 2;
          const tile = usedGet(carTileIndex);
          if (tile !== null) {
            const oldTile = car.tile();
            if (tile !== oldTile) {
              car.applyDerivedPosition(tile);
              this.unitGrid.updateUnitCell(car);
              didMove = true;
            }
          }
        }

        const newEngineTile = path[plan.cursor] as TileRef;
        const oldEngineTile = engine.tile();
        if (newEngineTile !== oldEngineTile) {
          engine.applyDerivedPosition(newEngineTile);
          this.unitGrid.updateUnitCell(engine);
          didMove = true;
        }
      }

      plan.lastAdvancedTick = currentTick;

      // Preserve the final-step redraw (plan remains for the tick where motion ends),
      // then clear once the train has settled and no longer moves.
      // Note: trains are currently deleted at the end of TrainExecution, and the ensuing
      // `Unit` update (isActive=false) also clears any associated motion plan records.
      // This expiry is defensive to avoid keeping stale plans around if that behavior changes.
      if (!didMove && plan.cursor >= lastIndex) {
        staleEngineIds.push(engineId);
      }
    }

    for (const engineId of staleEngineIds) {
      this.clearTrainPlanForUnit(engineId);
    }
  }

  private applyMotionPlanRecords(records: readonly MotionPlanRecord[]): void {
    for (const record of records) {
      switch (record.kind) {
        case "grid": {
          if (record.ticksPerStep < 1 || record.path.length < 1) {
            break;
          }
          const existing = this.unitMotionPlans.get(record.unitId);
          if (existing && record.planId <= existing.planId) {
            break;
          }

          const path =
            record.path instanceof Uint32Array
              ? record.path
              : Uint32Array.from(record.path);

          this.unitMotionPlans.set(record.unitId, {
            planId: record.planId,
            startTick: record.startTick,
            ticksPerStep: record.ticksPerStep,
            path,
          });
          this.markMotionPlannedUnitIdsDirty();
          break;
        }
        case "train": {
          if (record.speed < 1 || record.path.length < 1) {
            break;
          }
          const existing = this.trainMotionPlans.get(record.engineUnitId);
          if (existing && record.planId <= existing.planId) {
            break;
          }
          if (existing) {
            this.clearTrainPlanForUnit(record.engineUnitId);
          }

          const carUnitIds =
            record.carUnitIds instanceof Uint32Array
              ? record.carUnitIds
              : Uint32Array.from(record.carUnitIds);
          const path =
            record.path instanceof Uint32Array
              ? record.path
              : Uint32Array.from(record.path);

          const usedCap = carUnitIds.length * record.spacing + 3;
          const usedTilesBuf = new Uint32Array(Math.max(0, usedCap));

          this.trainMotionPlans.set(record.engineUnitId, {
            planId: record.planId,
            startTick: record.startTick,
            speed: record.speed,
            spacing: record.spacing,
            carUnitIds,
            path,
            cursor: 0,
            usedTilesBuf,
            usedHead: 0,
            usedLen: 0,
            lastAdvancedTick: record.startTick,
          });
          this.markMotionPlannedUnitIdsDirty();

          this.trainUnitToEngine.set(record.engineUnitId, record.engineUnitId);
          for (let i = 0; i < carUnitIds.length; i++) {
            const carId = carUnitIds[i] >>> 0;
            if (carId !== 0)
              this.trainUnitToEngine.set(carId, record.engineUnitId);
          }
          break;
        }
      }
    }
  }

  recentlyUpdatedTiles(): TileRef[] {
    return this.updatedTiles;
  }

  recentlyUpdatedTerrainTiles(): TileRef[] {
    return this.updatedTerrainTiles;
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitView; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
    ) as Array<{
      unit: UnitView;
      distSquared: number;
    }>;
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ) {
    return this.unitGrid.hasUnitNearby(
      tile,
      searchRange,
      type,
      playerId,
      includeUnderConstruction,
    );
  }

  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: UnitView) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean {
    return this.unitGrid.anyUnitNearby(
      tile,
      searchRange,
      types,
      predicate as (unit: Unit | UnitView) => boolean,
      playerId,
      includeUnderConstruction,
    );
  }

  myClientID(): ClientID | undefined {
    return this._myClientID;
  }

  myPlayer(): PlayerView | null {
    return this._myPlayer;
  }

  player(id: PlayerID): PlayerView {
    const player = this._players.get(id);
    if (player === undefined) {
      throw Error(`player id ${id} not found`);
    }
    return player;
  }

  players(): PlayerView[] {
    return Array.from(this._players.values());
  }

  /**
   * Recompute every player's theme-derived colors. Call when the active theme
   * changes mid-game (e.g. toggling colorblind mode) so existing territories
   * re-color; the renderer palette must be refreshed afterwards.
   */
  refreshPlayerColors(): void {
    for (const p of this._players.values()) {
      p.refreshColors();
    }
  }

  playerBySmallID(id: number): PlayerView | TerraNullius {
    if (id === 0) {
      return new TerraNulliusImpl();
    }
    const playerId = this.smallIDToID.get(id);
    if (playerId === undefined) {
      throw new Error(`small id ${id} not found`);
    }
    return this.player(playerId);
  }

  playerByClientID(id: ClientID): PlayerView | null {
    const player =
      Array.from(this._players.values()).filter(
        (p) => p.clientID() === id,
      )[0] ?? null;
    if (player === null) {
      return null;
    }
    return player;
  }
  hasPlayer(id: PlayerID): boolean {
    return false;
  }
  playerViews(): PlayerView[] {
    return Array.from(this._players.values());
  }

  owner(tile: TileRef): PlayerView | TerraNullius {
    return this.playerBySmallID(this.ownerID(tile));
  }

  ticks(): Tick {
    if (this.lastUpdate === null) return 0;
    return this.lastUpdate.tick;
  }
  inSpawnPhase(): boolean {
    return this.startTick === null;
  }

  isSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this._config.spawnImmunityDuration()
    );
  }
  isNationSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this._config.nationSpawnImmunityDuration()
    );
  }

  elapsedGameSeconds(): number {
    return this.ticksSinceStart() / 10;
  }

  ticksSinceStart(): Tick {
    if (this.inSpawnPhase()) {
      return 0;
    }

    return Math.max(0, this.ticks() - this.startTick!);
  }
  config(): Config {
    return this._config;
  }
  units(...types: UnitType[]): UnitView[] {
    if (types.length === 0) {
      return Array.from(this._units.values()).filter((u) => u.isActive());
    }
    return Array.from(this._units.values()).filter(
      (u) => u.isActive() && types.includes(u.type()),
    );
  }
  unit(id: number): UnitView | undefined {
    return this._units.get(id);
  }
  unitInfo(type: UnitType): UnitInfo {
    return this._config.unitInfo(type);
  }

  /**
   * Long-lived map of UnitState records, keyed by unit ID. Mutated in place
   * each tick by `update()`. Renderer code reads from this directly — the
   * UnitView wrapping each entry shares the same UnitState reference.
   *
   * Includes inactive units; renderer filters by `state.isActive`.
   */
  unitStates(): ReadonlyMap<number, import("../render/types").UnitState> {
    return this._unitStates;
  }

  /**
   * Long-lived map of PlayerState records, keyed by smallID. Mutated in place
   * each tick by `update()`. Renderer code reads from this directly.
   */
  playerStates(): ReadonlyMap<number, import("../render/types").PlayerState> {
    return this._playerStates;
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
  }
  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numLandTiles(): number {
    return this._map.numLandTiles();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isLand(ref: TileRef): boolean {
    return this._map.isLand(ref);
  }
  isImpassable(ref: TileRef): boolean {
    return this._map.isImpassable(ref);
  }
  isOceanShore(ref: TileRef): boolean {
    return this._map.isOceanShore(ref);
  }
  isOcean(ref: TileRef): boolean {
    return this._map.isOcean(ref);
  }
  isShoreline(ref: TileRef): boolean {
    return this._map.isShoreline(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  terrainByte(ref: TileRef): number {
    return this._map.terrainByte(ref);
  }
  setWater(ref: TileRef): void {
    this._map.setWater(ref);
  }
  setShorelineBit(ref: TileRef): void {
    this._map.setShorelineBit(ref);
  }
  clearShorelineBit(ref: TileRef): void {
    this._map.clearShorelineBit(ref);
  }
  setOcean(ref: TileRef): void {
    this._map.setOcean(ref);
  }
  setMagnitude(ref: TileRef, value: number): void {
    this._map.setMagnitude(ref, value);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  setFallout(ref: TileRef, value: boolean): void {
    return this._map.setFallout(ref, value);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  forEachNeighbor(ref: TileRef, callback: (neighbor: TileRef) => void): void {
    this._map.forEachNeighbor(ref, callback);
  }
  neighbors4(ref: TileRef, out: TileRef[]): number {
    return this._map.neighbors4(ref, out);
  }
  forEachNeighborWithDiag(
    ref: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void {
    this._map.forEachNeighborWithDiag(ref, callback);
  }
  isWater(ref: TileRef): boolean {
    return this._map.isWater(ref);
  }
  isShore(ref: TileRef): boolean {
    return this._map.isShore(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef> {
    return this._map.circleSearch(tile, radius, filter);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    return this._map.bfs(tile, filter);
  }
  tileState(tile: TileRef): number {
    return this._map.tileState(tile);
  }
  tileStateBuffer(): Uint16Array {
    return this._map.tileStateBuffer();
  }
  updateTile(tile: TileRef, state: number): boolean {
    return this._map.updateTile(tile, state);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  gameID(): GameID {
    return this._gameID;
  }

  focusedPlayer(): PlayerView | null {
    return this.myPlayer();
  }
}
