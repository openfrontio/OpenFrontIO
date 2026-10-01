/**
 * Builds the renderer's FrameData from decoded replay frames, like
 * GameView.populateFrame does from the worker's updates. A replay has no
 * local player, so there are no attack rings, conquest FX or transitive
 * targets.
 *
 * Things a frame doesn't carry are rebuilt here:
 *   - trails, from unit positions frame by frame. A seek restarts them
 *     since the frame doesn't have a unit's earlier path.
 *   - railroads, by replaying the railroad events tick by tick, so a seek
 *     ends up on the same network the live game had.
 *   - dead-unit FX, from the dead-unit events.
 *   - the spawn phase, from the spawn-phase-end tick.
 *   - when nuke telegraphs start, from the motion plan delivery ticks.
 *
 * The returned FrameData is a single object updated every frame, same as
 * GameView's. tests/client/replay/ReplayFrameBuilder.test.ts compares the
 * two frame by frame.
 */

import {
  GameUpdateType,
  type GameUpdateViewData,
} from "../../core/game/GameUpdates";
import { computeAllianceClusters } from "../render/frame/derive/AllianceClusters";
import { extractNukeTelegraphs } from "../render/frame/derive/NukeTelegraphs";
import { computePlayerStatus } from "../render/frame/derive/PlayerStatus";
import { buildRelationMatrix } from "../render/frame/derive/RelationMatrix";
import { RailroadCache } from "../render/frame/RailroadCache";
import { SpiralTrails, type SpiralParams } from "../render/frame/SpiralTrails";
import { TrailManager } from "../render/frame/TrailManager";
import type {
  BonusEvent,
  DeadUnitFx,
  FrameData,
  NameEntry,
  PlayerState,
  PlayerStatic,
  UnitState,
} from "../render/types";
import { STRUCTURE_TYPES, TRAIL_TYPES } from "../render/types/UnitType";
import type {
  RailroadEvent,
  ReplayAppend,
  ReplayEvents,
  ReplayFrame,
  ReplayHeader,
} from "./codec/ReplayTypes";
import { RailroadEventKind } from "./codec/ReplayTypes";

/** Game rules the derived data needs (from the game's Config). */
export interface ReplayRules {
  allianceDuration: number;
  doomsdayClockWarnTicks: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class ReplayFrameBuilder {
  private readonly frame: Mutable<FrameData>;
  private readonly trails: TrailManager;
  /** Helix ribbons for players whose nukeTrail cosmetic is a spiral. */
  private readonly spirals: SpiralTrails;
  private readonly railroads: RailroadCache;
  /** Last tick whose railroad events were applied (-1: none). */
  private railroadTick = -1;
  private readonly railroadUpdates = new Map<
    number,
    GameUpdateViewData["updates"]
  >();
  /** The ticks in railroadUpdates, ascending. */
  private readonly railroadTicks: number[] = [];
  private readonly deadUnits = new Map<number, DeadUnitFx[]>();
  /** Grid plans per unit, in the order they arrived. */
  private readonly gridPlans = new Map<
    number,
    { tick: number; startTick: number }[]
  >();
  private readonly teams = new Map<number, string>();
  private readonly smallIDs = new Map<string, number>();
  private readonly playerIDs = new Map<number, string>();
  /** Name placement for every known player, see populateNames. */
  private readonly names = new Map<string, NameEntry>();

  /** Players as of the last relation rebuild, to spot changes. */
  private relationInputs = new Map<number, PlayerState>();
  /** Structures as of the last frame. */
  private structures = new Map<number, UnitState>();
  /** Last frame's trail units, kept one frame after they die (like live). */
  private trailUnits = new Map<number, UnitState>();

  constructor(
    private readonly header: ReplayHeader,
    private readonly rules: ReplayRules,
  ) {
    const w = header.mapWidth;
    const h = header.mapHeight;
    this.trails = new TrailManager(w, h);
    this.spirals = new SpiralTrails(w);
    this.railroads = new RailroadCache(w, h);

    this.index(header, header.players);

    this.frame = {
      tick: 0,
      inSpawnPhase: true,
      tileState: new Uint16Array(w * h),
      trailState: this.trails.getTrailState(),
      spiralRibbons: this.spirals.getRibbons(),
      railroadState: this.railroads.railroadState,
      units: new Map(),
      players: new Map(),
      names: this.names,
      events: { deadUnits: [], conquestEvents: [], bonusEvents: [] },
      changedTiles: null,
      railroadDirty: false,
      revealedRailTiles: this.railroads.revealedRailTiles,
      trailDirtyRowMin: 0,
      trailDirtyRowMax: -1,
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

  /** Whether emojis are drawn (the "emojis" user setting). */
  showEmojis: () => boolean = () => true;

  /** More of a game that's still being processed (ReplayReader.append). */
  append(more: ReplayAppend): void {
    this.index(more.events, more.players);
  }

  /** Index events by tick and players by id. */
  private index(events: ReplayEvents, players: readonly PlayerStatic[]): void {
    for (const e of events.railroadEvents) this.indexRailroadEvent(e);
    for (const d of events.deadUnitEvents) {
      let list = this.deadUnits.get(d.tick);
      if (list === undefined) this.deadUnits.set(d.tick, (list = []));
      list.push({
        unitType: d.unitType,
        pos: d.pos,
        reachedTarget: d.reachedTarget,
        ownerSmallID: d.ownerSmallID,
      });
    }
    for (const p of events.motionPlans) {
      let list = this.gridPlans.get(p.unitId);
      if (list === undefined) this.gridPlans.set(p.unitId, (list = []));
      list.push({ tick: p.tick, startTick: p.startTick });
    }
    for (const p of players) {
      this.smallIDs.set(p.id, p.smallID);
      this.playerIDs.set(p.smallID, p.id);
      if (p.team !== null) this.teams.set(p.smallID, p.team);
    }
  }

  /** The frame a seek landed on: full upload, no FX, trails restarted. */
  seek(f: ReplayFrame): FrameData {
    this.trails.reset();
    this.spirals.reset();
    this.trailUnits.clear();
    if (f.tick < this.railroadTick) {
      this.railroads.reset();
      this.railroadTick = -1;
    }
    this.advanceRailroads(f.tick);
    // After a seek, show the network without this tick's build animation.
    this.railroads.revealedRailTiles.length = 0;
    this.railroads.railroadDirty = true;
    this.relationInputs.clear();
    this.structures.clear();
    this.populate(f, false);
    this.frame.changedTiles = null;
    this.frame.structuresDirty = true;
    return this.frame;
  }

  /** The next frame in sequence (ReplayReader.next). */
  advance(f: ReplayFrame): FrameData {
    this.advanceRailroads(f.tick);
    this.populate(f, true);
    this.frame.changedTiles = f.changedTiles;
    return this.frame;
  }

  private populate(f: ReplayFrame, withEvents: boolean): void {
    const fd = this.frame;
    fd.tick = f.tick;
    const spawnEnd = this.header.spawnPhaseEnd;
    fd.inSpawnPhase = spawnEnd === null || f.tick < spawnEnd.tick;
    fd.tileState = f.tileState;
    fd.units = f.units;
    fd.players = this.showEmojis() ? f.players : withoutEmojis(f.players);
    this.populateNames(f);

    this.updateTrails(f.units);
    fd.trailDirtyRowMin = this.trails.dirtyRowMin;
    fd.trailDirtyRowMax = this.trails.dirtyRowMax;
    fd.railroadDirty = this.railroads.railroadDirty;
    this.railroads.clearDirty();

    const ev = fd.events;
    ev.deadUnits.length = 0;
    ev.conquestEvents.length = 0; // local player only
    ev.bonusEvents.length = 0;
    if (withEvents) {
      ev.deadUnits.push(...(this.deadUnits.get(f.tick) ?? []));
      ev.bonusEvents.push(...this.bonusEvents(f));
    }

    fd.playerStatus = computePlayerStatus(f.players, f.units, {
      localPlayerSmallID: 0,
      localPlayerID: "",
      tileState: f.tileState,
      tick: f.tick,
      allianceDuration: this.rules.allianceDuration,
      isTransitiveTarget: () => false,
      doomsdayClockWarnTicks: this.rules.doomsdayClockWarnTicks,
    });
    fd.relationsDirty = this.relationsChanged(f.players);
    if (fd.relationsDirty) {
      const rel = buildRelationMatrix(f.players, this.teams);
      fd.relationMatrix = rel.matrix;
      fd.relationSize = rel.size;
      fd.allianceClusters = computeAllianceClusters(f.players);
    }
    fd.nukeTelegraphs = extractNukeTelegraphs(
      f.units,
      this.header.mapWidth,
      0,
      fd.relationMatrix,
      fd.relationSize,
      this.deliveredPlans(f),
      f.tick,
    );
    fd.attackRings = []; // local player only
    fd.structuresDirty = this.structuresChanged(f.units);
  }

  private updateTrails(units: ReadonlyMap<number, UnitState>): void {
    this.trails.clearDirtyRows();
    const tracked: number[] = [];
    const current = new Map<number, UnitState>();
    for (const u of units.values()) {
      if (!u.isActive || !TRAIL_TYPES.has(u.unitType)) continue;
      tracked.push(u.id);
      current.set(u.id, u);
    }
    // GameView keeps a dead unit in its map for the tick it died, so its
    // trail clears one tick later. The replay drops it right away, so
    // last frame's trail units that just disappeared are kept for a frame.
    let view = units as Map<number, UnitState>;
    for (const [id, u] of this.trailUnits) {
      if (units.has(id)) continue;
      if (view === units) view = new Map(units);
      view.set(id, u);
    }
    this.trails.update(view, tracked);
    // The same units grow the spiral nuke ribbons.
    this.spirals.update(view, tracked);
    this.trailUnits = current;
  }

  /** A player's spiral nuke trail cosmetic, resolved by the viewer. */
  setNukeTrailSpiral(smallID: number, params: SpiralParams): void {
    this.spirals.setParams(smallID, params);
  }

  clearNukeTrailSpiral(smallID: number): void {
    this.spirals.clearParams(smallID);
  }

  private advanceRailroads(tick: number): void {
    // Animations advance once per tick even without events, same as live.
    const empty = {} as GameUpdateViewData["updates"];
    let t = this.railroadTick + 1;
    while (t <= tick) {
      // With nothing being drawn in, a tick without events changes nothing,
      // so a seek jumps to the next tick that has some. The target tick is
      // always applied, which clears the tiles revealed before it.
      const updates = this.railroadUpdates.get(t);
      if (t < tick && updates === undefined && !this.railroads.animating) {
        t = Math.min(tick, this.nextRailroadTick(t));
        continue;
      }
      this.railroads.apply({ updates: updates ?? empty } as GameUpdateViewData);
      t++;
    }
    this.railroadTick = Math.max(this.railroadTick, tick);
  }

  /** The first tick at or after `t` with railroad events, or Infinity. */
  private nextRailroadTick(t: number): number {
    const ticks = this.railroadTicks;
    let lo = 0;
    let hi = ticks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ticks[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return ticks[lo] ?? Infinity;
  }

  private indexRailroadEvent(e: RailroadEvent): void {
    let updates = this.railroadUpdates.get(e.tick);
    if (updates === undefined) {
      updates = {
        [GameUpdateType.RailroadConstructionEvent]: [],
        [GameUpdateType.RailroadSnapEvent]: [],
        [GameUpdateType.RailroadDestructionEvent]: [],
      } as unknown as GameUpdateViewData["updates"];
      this.railroadUpdates.set(e.tick, updates);
      const ticks = this.railroadTicks;
      ticks.push(e.tick);
      // Events come in tick order, appends included, so this rarely sorts.
      if (ticks.length > 1 && ticks[ticks.length - 2] > e.tick) {
        ticks.sort((a, b) => a - b);
      }
    }
    switch (e.kind) {
      case RailroadEventKind.Construction:
        updates[GameUpdateType.RailroadConstructionEvent].push({
          type: GameUpdateType.RailroadConstructionEvent,
          id: e.id,
          tiles: e.tiles,
        });
        break;
      case RailroadEventKind.Snap:
        updates[GameUpdateType.RailroadSnapEvent].push({
          type: GameUpdateType.RailroadSnapEvent,
          originalId: e.originalId,
          newId1: e.newId1,
          newId2: e.newId2,
          tiles1: e.tiles1,
          tiles2: e.tiles2,
        });
        break;
      case RailroadEventKind.Destruction:
        updates[GameUpdateType.RailroadDestructionEvent].push({
          type: GameUpdateType.RailroadDestructionEvent,
          id: e.id,
        });
        break;
    }
  }

  private bonusEvents(f: ReplayFrame): BonusEvent[] {
    const out: BonusEvent[] = [];
    for (const raw of f.miscUpdates?.BonusEvent ?? []) {
      const b = raw as {
        player: string;
        tile: number;
        gold: number;
        troops: number;
      };
      const smallID = this.smallIDs.get(b.player);
      if (smallID === undefined || !f.players.has(smallID)) continue;
      out.push({
        playerID: b.player,
        smallID,
        tile: b.tile,
        gold: Number(b.gold),
        troops: b.troops,
      });
    }
    return out;
  }

  /**
   * GameView lists every player it knows at (0, 0, size 0) until a
   * placement arrives. The file only has the placements.
   */
  private populateNames(f: ReplayFrame): void {
    this.names.clear();
    for (const smallID of f.players.keys()) {
      const playerID = this.playerIDs.get(smallID);
      if (playerID === undefined) continue;
      this.names.set(
        playerID,
        f.names.get(playerID) ?? { playerID, x: 0, y: 0, size: 0 },
      );
    }
  }

  /**
   * Whether allies, embargoes or the set of players changed since the last
   * rebuild. Always true after a seek, which clears the inputs.
   */
  private relationsChanged(players: ReadonlyMap<number, PlayerState>): boolean {
    let changed =
      this.relationInputs.size === 0 ||
      players.size !== this.relationInputs.size;
    for (const [sid, p] of players) {
      const prev = this.relationInputs.get(sid);
      if (prev === p) continue;
      if (
        prev === undefined ||
        !sameIDs(prev.allies, p.allies) ||
        !sameIDs(prev.embargoes, p.embargoes)
      ) {
        changed = true;
      }
      this.relationInputs.set(sid, p);
    }
    return changed;
  }

  /**
   * Whether a structure appeared, disappeared, changed owner or level, or
   * finished construction (GameView's structuresDirty rule).
   */
  private structuresChanged(units: ReadonlyMap<number, UnitState>): boolean {
    let changed = false;
    let seen = 0;
    for (const u of units.values()) {
      if (!STRUCTURE_TYPES.has(u.unitType)) continue;
      seen++;
      const prev = this.structures.get(u.id);
      if (prev === u) continue;
      if (
        prev === undefined ||
        prev.ownerID !== u.ownerID ||
        prev.level !== u.level ||
        prev.isActive !== u.isActive ||
        (prev.underConstruction && !u.underConstruction)
      ) {
        changed = true;
      }
      this.structures.set(u.id, u);
    }
    if (seen !== this.structures.size) {
      changed = true;
      for (const id of this.structures.keys()) {
        if (!units.has(id)) this.structures.delete(id);
      }
    }
    return changed;
  }

  /** Each unit's latest grid plan that has arrived by this frame. */
  private deliveredPlans(
    f: ReplayFrame,
  ): ReadonlyMap<number, { startTick: number }> {
    const out = new Map<number, { startTick: number }>();
    for (const id of f.units.keys()) {
      const plans = this.gridPlans.get(id);
      if (plans === undefined) continue;
      let latest: { startTick: number } | undefined;
      for (const p of plans) {
        if (p.tick > f.tick) break;
        latest = p;
      }
      if (latest !== undefined) out.set(id, latest);
    }
    return out;
  }
}

/** The players without emojis, copying only the ones that had any. */
function withoutEmojis(
  players: ReadonlyMap<number, PlayerState>,
): ReadonlyMap<number, PlayerState> {
  let out: Map<number, PlayerState> | null = null;
  for (const [sid, p] of players) {
    if (p.outgoingEmojis.length === 0) continue;
    out ??= new Map(players);
    out.set(sid, { ...p, outgoingEmojis: [] });
  }
  return out ?? players;
}

function sameIDs(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
