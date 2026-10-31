/**
 * BuildPreviewController — build-ghost state machine + click-to-build flow.
 *
 * All rendering for the build ghost (outline, range circle, rail snap,
 * crosshair) lives in the WebGL renderer. This controller owns the state:
 * it queries buildables for the cursor tile, tracks whether the placement
 * is valid, and pushes preview data straight to the WebGL view.
 */

import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  BuildableUnit,
  bulkCost,
  PlayerBuildableUnitType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  listNukeBreakAlliance,
  wouldNukeBreakAlliance,
} from "@openfront/engine-lib/execution/NukeAlliance";
import { EventBus } from "@openfront/shared/EventBus";
import { Controller } from "../Controller";
import {
  ConfirmGhostStructureEvent,
  MouseMoveEvent,
  MouseUpEvent,
} from "../InputHandler";
import type { MapRenderer } from "../render/gl";
import {
  buildNukeTrajectory,
  type SAMInfo,
} from "../render/gl/utils/NukeTrajectory";
import type { GhostPreviewData } from "../render/types";
import { TransformHandler } from "../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { UIState } from "../UIState";
import { UserSettings } from "../UserSettings";
import { GameView } from "../view";

// tSamIntercept value used to flag an untargetable (impassable) destination:
// draws the red X marker essentially at the destination while leaving the
// visible line unchanged (1.0 would mean "no marker").
const T_BLOCKED_DST = 0.9999;

/**
 * Whether a SAM belongs in the nuke trajectory preview's threat set.
 * Mirrors SAMLauncherExecution: a SAM ignores a nuke whose owner it's
 * friendly with (same team OR allied).
 * Teammates are excluded unconditionally — a strike can break an alliance
 * but never a team relationship, so a teammate's SAM never engages.
 * Allied SAMs are excluded unless the strike would betray that ally — the
 * alliance breaks at launch, so their SAMs will engage the nuke.
 * (Own SAMs never threaten; the caller filters those out first.)
 */
export function samThreatensNukePreview(
  samOwnerSmallId: number,
  teammateSmallIds: ReadonlySet<number>,
  allySmallIds: ReadonlySet<number>,
  betrayedSmallIds: ReadonlySet<number>,
): boolean {
  if (teammateSmallIds.has(samOwnerSmallId)) return false;
  return (
    !allySmallIds.has(samOwnerSmallId) || betrayedSmallIds.has(samOwnerSmallId)
  );
}

interface NukeTrajectoryStatic {
  srcX: number;
  srcY: number;
  targetTile: TileRef;
  directionUp: boolean;
  sams: SAMInfo[];
}

const EMPTY_ID_SET: ReadonlySet<number> = new Set();

function samArraysEqual(a: readonly SAMInfo[], b: readonly SAMInfo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const s1 = a[i];
    const s2 = b[i];
    if (s1.x !== s2.x || s1.y !== s2.y || s1.r !== s2.r) {
      return false;
    }
  }
  return true;
}

function tileRefArraysEqual(
  a: readonly TileRef[] | undefined,
  b: readonly TileRef[] | undefined,
): boolean {
  if (a === b) return true;
  const aLen = a?.length ?? 0;
  const bLen = b?.length ?? 0;
  if (aLen !== bLen) return false;
  if (aLen === 0) return true;
  for (let i = 0; i < aLen; i++) {
    if (a![i] !== b![i]) return false;
  }
  return true;
}

function ghostRailPathsEqual(
  a: readonly (readonly TileRef[])[] | undefined,
  b: readonly (readonly TileRef[])[] | undefined,
): boolean {
  if (a === b) return true;
  const aLen = a?.length ?? 0;
  const bLen = b?.length ?? 0;
  if (aLen !== bLen) return false;
  if (aLen === 0) return true;
  for (let i = 0; i < aLen; i++) {
    if (!tileRefArraysEqual(a![i], b![i])) return false;
  }
  return true;
}

function isGhostDataEqual(
  prev: GhostPreviewData,
  next: GhostPreviewData,
): boolean {
  if (
    prev.ghostType !== next.ghostType ||
    prev.tileX !== next.tileX ||
    prev.tileY !== next.tileY ||
    prev.snapToPlacement !== next.snapToPlacement ||
    prev.radiusTileX !== next.radiusTileX ||
    prev.radiusTileY !== next.radiusTileY ||
    prev.canBuild !== next.canBuild ||
    prev.canUpgrade !== next.canUpgrade ||
    prev.cost !== next.cost ||
    prev.multiplier !== next.multiplier ||
    prev.showCost !== next.showCost ||
    prev.canAfford !== next.canAfford ||
    prev.ownerID !== next.ownerID ||
    prev.upgradeTargetTile !== next.upgradeTargetTile ||
    prev.rangeRadius !== next.rangeRadius ||
    prev.rangeWarning !== next.rangeWarning
  ) {
    return false;
  }
  return (
    tileRefArraysEqual(prev.overlappingRailroads, next.overlappingRailroads) &&
    ghostRailPathsEqual(prev.ghostRailPaths, next.ghostRailPaths)
  );
}

function findBestSilo(
  myPlayer: NonNullable<ReturnType<GameView["myPlayer"]>>,
  game: GameView,
  dstX: number,
  dstY: number,
) {
  const silos = myPlayer.units(UnitType.MissileSilo);
  let bestSilo: (typeof silos)[number] | null = null;
  let minDistance = Infinity;
  for (let i = 0; i < silos.length; i++) {
    const u = silos[i];
    if (!u.isActive() || u.isInCooldown() || u.isUnderConstruction()) {
      continue;
    }
    const dist =
      Math.abs(game.x(u.tile()) - dstX) + Math.abs(game.y(u.tile()) - dstY);
    if (dist < minDistance) {
      minDistance = dist;
      bestSilo = u;
    }
  }
  return bestSilo;
}

function samThreatens(
  s: ReturnType<GameView["units"]>[number],
  myPlayer: NonNullable<ReturnType<GameView["myPlayer"]>>,
  teammateIds: ReadonlySet<number>,
  allyIds: ReadonlySet<number>,
  betrayedIds: ReadonlySet<number>,
): boolean {
  if (!s.isActive()) return false;
  const owner = s.owner();
  if (owner === myPlayer) return false;
  return samThreatensNukePreview(
    owner.smallID(),
    teammateIds,
    allyIds,
    betrayedIds,
  );
}

function collectThreateningSams(
  game: GameView,
  myPlayer: NonNullable<ReturnType<GameView["myPlayer"]>>,
  teammateIds: ReadonlySet<number>,
  allyIds: ReadonlySet<number>,
  betrayedIds: ReadonlySet<number>,
): SAMInfo[] {
  const sams: SAMInfo[] = [];
  const samUnits = game.units(UnitType.SAMLauncher);
  for (let i = 0; i < samUnits.length; i++) {
    const s = samUnits[i];
    if (!samThreatens(s, myPlayer, teammateIds, allyIds, betrayedIds)) {
      continue;
    }
    sams.push({
      x: game.x(s.tile()),
      y: game.y(s.tile()),
      r: game.config().samRange(s.level()),
    });
  }
  return sams;
}

function isTrajectoryEqual(
  prev: NukeTrajectoryStatic | null,
  next: NukeTrajectoryStatic,
): boolean {
  return (
    prev !== null &&
    prev.srcX === next.srcX &&
    prev.srcY === next.srcY &&
    prev.targetTile === next.targetTile &&
    prev.directionUp === next.directionUp &&
    samArraysEqual(prev.sams, next.sams)
  );
}

export class BuildPreviewController implements Controller {
  /** Current ghost (null when no build type is active). */
  private ghostUnit: { buildableUnit: BuildableUnit } | null = null;
  private readonly connectedAllySmallIds: Set<number> = new Set();
  private readonly usedSafetyAllies: Set<number> = new Set();
  private readonly teammateIds: Set<number> = new Set();
  private readonly allyIds: Set<number> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private lastGhostQueryAt: number = 0;
  private lastQueriedTileRef: TileRef | undefined = undefined;
  private isQueryInFlight: boolean = false;
  private pendingTileRef: TileRef | undefined | null = null;
  private querySeq: number = 0;
  private pendingConfirm: { tile: TileRef; preventStacking: boolean } | null =
    null;
  private resolvedGhostTile: TileRef | undefined;
  private ghostResolved = false;

  // Buildable validation runs on the snapped tile under the cursor, but the
  // rendered icon follows the cursor at sub-tile precision so motion is
  // continuous instead of stepping tile-to-tile. cursorLoop re-emits each
  // frame with the current cursor world position.
  private lastGhostData: GhostPreviewData | null = null;

  // Static inputs for the nuke trajectory preview (source silo + threatening
  // SAMs). Recomputed in the throttled renderGhost path; cursorLoop rebuilds
  // the Bezier each frame with the live cursor position as the destination so
  // the arc tracks the cursor smoothly instead of snapping tile-to-tile.
  private nukeTrajectoryStatic: NukeTrajectoryStatic | null = null;

  // Cached state for cursorLoop idle-diffing.
  private prevGhostDataRef: GhostPreviewData | null = null;
  private prevTrajRef: NukeTrajectoryStatic | null = null;
  private lastWorldX: number | null = null;
  private lastWorldY: number | null = null;
  private renderedGhostBuffer: GhostPreviewData | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
    private userSettings: UserSettings,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.requestConfirmStructure(e));
    this.eventBus.on(ConfirmGhostStructureEvent, () =>
      this.requestConfirmStructure(
        new MouseUpEvent(this.mousePos.x, this.mousePos.y),
      ),
    );

    const rafLoop = () => {
      this.cursorLoop();
      requestAnimationFrame(rafLoop);
    };
    requestAnimationFrame(rafLoop);
  }

  private resetCursorCaches(): void {
    this.lastWorldX = null;
    this.lastWorldY = null;
    this.prevGhostDataRef = null;
    this.prevTrajRef = null;
    this.renderedGhostBuffer = null;
  }

  private cursorLoop(): void {
    const ghost = this.lastGhostData;
    const traj = this.nukeTrajectoryStatic;
    if (ghost === null && traj === null) {
      this.resetCursorCaches();
      return;
    }

    const w = this.transformHandler.screenToWorldCoordinatesFloat(
      this.mousePos.x,
      this.mousePos.y,
    );
    if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) {
      return;
    }

    const posChanged =
      this.lastWorldX === null ||
      this.lastWorldY === null ||
      w.x !== this.lastWorldX ||
      w.y !== this.lastWorldY;

    this.updateGhostFrame(ghost, w, posChanged);
    this.updateTrajectoryFrame(traj, w, posChanged);
    this.lastWorldX = w.x;
    this.lastWorldY = w.y;
  }

  private updateGhostFrame(
    ghost: GhostPreviewData | null,
    w: { x: number; y: number },
    posChanged: boolean,
  ): void {
    if (ghost === null) {
      this.prevGhostDataRef = null;
      this.renderedGhostBuffer = null;
      return;
    }
    if (!posChanged && ghost === this.prevGhostDataRef) return;
    let buf = this.renderedGhostBuffer;
    if (ghost !== this.prevGhostDataRef || buf === null) {
      buf = { ...ghost };
      this.renderedGhostBuffer = buf;
    }
    buf.tileX = ghost.snapToPlacement ? ghost.tileX : w.x - 0.5;
    buf.tileY = ghost.snapToPlacement ? ghost.tileY : w.y - 0.5;
    const follows =
      !ghost.snapToPlacement &&
      !(ghost.canUpgrade && ghost.upgradeTargetTile !== null);
    buf.radiusTileX = follows ? w.x - 0.5 : ghost.radiusTileX;
    buf.radiusTileY = follows ? w.y - 0.5 : ghost.radiusTileY;
    this.view.updateGhostPreview(buf);
    this.prevGhostDataRef = ghost;
  }

  private updateTrajectoryFrame(
    traj: NukeTrajectoryStatic | null,
    w: { x: number; y: number },
    posChanged: boolean,
  ): void {
    if (traj === null) {
      this.prevTrajRef = null;
      return;
    }
    if (!posChanged && traj === this.prevTrajRef) return;
    const data = buildNukeTrajectory(
      traj.srcX,
      traj.srcY,
      w.x - 0.5,
      w.y - 0.5,
      this.game.height(),
      traj.directionUp,
      traj.sams,
    );
    const tx = Math.floor(w.x);
    const ty = Math.floor(w.y);
    if (
      this.game.isValidCoord(tx, ty) &&
      this.game.isImpassable(this.game.ref(tx, ty))
    ) {
      data.tSamIntercept = Math.min(data.tSamIntercept, T_BLOCKED_DST);
    }
    this.view.updateNukeTrajectory(data);
    this.prevTrajRef = traj;
  }

  private getTileForCoordinates(x: number, y: number): TileRef | undefined {
    const tile = this.transformHandler.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(tile.x, tile.y)) {
      return undefined;
    }
    return this.game.ref(tile.x, tile.y);
  }

  private getHoveredTile(): TileRef | undefined {
    return this.getTileForCoordinates(this.mousePos.x, this.mousePos.y);
  }

  private getTileForEvent(e: MouseUpEvent): TileRef | undefined {
    return this.getTileForCoordinates(e.x, e.y);
  }

  tick() {
    // Re-query buildables periodically (world state can change — tiles may
    // become buildable as troops/territory move).
    this.syncGhostState();
    if (!this.isQueryInFlight) {
      this.renderGhost();
    }
  }

  /**
   * Reconcile our internal ghost state with uiState.ghostStructure. Other
   * UI bits (build menu, key bindings) toggle uiState; we mirror it here.
   */
  private syncGhostState(): void {
    const target = this.uiState.ghostStructure;
    if (this.ghostUnit) {
      if (target === null) {
        this.removeGhostStructure();
      } else if (target !== this.ghostUnit.buildableUnit.type) {
        this.clearGhostStructure();
        this.createGhostStructure(target);
      }
    } else if (target !== null) {
      this.createGhostStructure(target);
    }
  }

  private checkTargetingAlly(tileRef: TileRef | undefined): boolean {
    if (tileRef === undefined || !this.ghostUnit) return false;
    const myPlayer = this.game.myPlayer();
    const nukeType = this.ghostUnit.buildableUnit.type;
    if (
      !myPlayer ||
      (nukeType !== UnitType.AtomBomb && nukeType !== UnitType.HydrogenBomb)
    ) {
      return false;
    }
    this.connectedAllySmallIds.clear();
    for (const ally of myPlayer.allies()) {
      if (!ally.isDisconnected()) {
        this.connectedAllySmallIds.add(ally.smallID());
      }
    }
    if (this.connectedAllySmallIds.size === 0) return false;
    return wouldNukeBreakAlliance({
      game: this.game,
      targetTile: tileRef,
      magnitude: this.game.config().nukeMagnitudes(nukeType),
      allySmallIds: this.connectedAllySmallIds,
      threshold: this.game.config().nukeAllianceBreakThreshold(),
    });
  }

  private resolveGhostTarget(
    targetX = this.mousePos.x,
    targetY = this.mousePos.y,
  ): {
    tileRef: TileRef | undefined;
    trajectoryTileRef: TileRef | undefined;
    targetingAlly: boolean;
  } {
    let tileRef: TileRef | undefined;
    let trajectoryTileRef: TileRef | undefined;
    // Resolve a queued click before following subsequent pointer movement.
    const tile =
      this.pendingConfirm !== null
        ? {
            x: this.game.x(this.pendingConfirm.tile),
            y: this.game.y(this.pendingConfirm.tile),
          }
        : this.transformHandler.screenToWorldCoordinates(targetX, targetY);
    if (this.game.isValidCoord(tile.x, tile.y)) {
      tileRef = this.game.ref(tile.x, tile.y);
      trajectoryTileRef = tileRef;
      const impassable = this.game.isImpassable
        ? this.game.isImpassable(tileRef)
        : false;
      if (impassable) {
        tileRef = undefined;
      }
    }
    const targetingAlly = this.checkTargetingAlly(tileRef);
    return { tileRef, trajectoryTileRef, targetingAlly };
  }

  private handleBuildablesResponse(
    buildables: BuildableUnit[],
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
    trajectoryTileRef: TileRef | undefined,
  ): void {
    if (!this.ghostUnit) {
      this.pendingConfirm = null;
      this.emitGhostPreview(tileRef, targetingAlly, trajectoryTileRef);
      return;
    }

    const unit = buildables.find(
      (u) => u.type === this.ghostUnit!.buildableUnit.type,
    );
    if (!unit) {
      Object.assign(this.ghostUnit.buildableUnit, {
        canBuild: false,
        canUpgrade: false,
      });
      this.pendingConfirm = null;
      this.emitGhostPreview(tileRef, targetingAlly, trajectoryTileRef);
      return;
    }

    this.ghostUnit.buildableUnit = unit;

    if (this.pendingConfirm !== null) {
      if (this.pendingConfirm.tile !== tileRef) {
        this.lastGhostQueryAt = -Infinity;
        this.renderGhost();
        return;
      }
      const confirmation = this.pendingConfirm;
      this.pendingConfirm = null;
      if (this.isGhostReadyForConfirm(confirmation.preventStacking)) {
        this.createStructure(confirmation.tile, confirmation.preventStacking);
      }
    }

    this.emitGhostPreview(tileRef, targetingAlly, trajectoryTileRef);
  }

  private onQueryFinished(seq: number): void {
    if (seq !== this.querySeq) return;
    this.isQueryInFlight = false;
    if (this.pendingConfirm !== null) {
      if (this.pendingConfirm.tile !== this.lastQueriedTileRef) {
        this.renderGhost();
        return;
      }
    }
    if (this.pendingTileRef !== null) {
      const nextTile = this.pendingTileRef;
      this.pendingTileRef = null;
      if (nextTile !== this.lastQueriedTileRef) {
        this.renderGhost();
      }
    }
  }

  private dispatchBuildablesQuery(
    seq: number,
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
    trajectoryTileRef: TileRef | undefined,
  ): void {
    const ghost = this.ghostUnit;
    const myPlayer = this.game?.myPlayer();
    if (!ghost || !myPlayer) {
      this.isQueryInFlight = false;
      this.pendingConfirm = null;
      return;
    }

    const preventStacking =
      this.pendingConfirm?.preventStacking ?? !!this.uiState.preventStacking;
    const promise = myPlayer.buildables
      ? myPlayer.buildables(
          tileRef,
          [ghost.buildableUnit.type],
          preventStacking,
        )
      : null;

    if (!promise) {
      this.isQueryInFlight = false;
      this.emitGhostPreview(tileRef, targetingAlly, trajectoryTileRef);
      return;
    }

    promise
      .then((b) => {
        if (this.ghostUnit !== ghost || seq !== this.querySeq) {
          return;
        }
        if (this.uiState.ghostStructure !== ghost.buildableUnit.type) {
          this.syncGhostState();
          return;
        }
        this.isQueryInFlight = false;
        if (
          preventStacking !==
          (this.pendingConfirm?.preventStacking ??
            !!this.uiState.preventStacking)
        ) {
          this.lastGhostQueryAt = -Infinity;
          this.renderGhost();
          return;
        }
        this.ghostResolved = true;
        this.resolvedGhostTile = tileRef;
        this.handleBuildablesResponse(
          b,
          tileRef,
          targetingAlly,
          trajectoryTileRef,
        );
      })
      .catch((err) => {
        if (this.ghostUnit !== ghost || seq !== this.querySeq) return;
        this.pendingConfirm = null;
        console.error("Failed to query buildables:", err);
      })
      .finally(() => this.onQueryFinished(seq));
  }

  renderGhost(): void {
    if (!this.ghostUnit || this.isQueryInFlight) {
      return;
    }

    this.isQueryInFlight = true;
    const { tileRef, trajectoryTileRef, targetingAlly } =
      this.resolveGhostTarget();
    this.lastQueriedTileRef = tileRef;

    const seq = ++this.querySeq;
    this.dispatchBuildablesQuery(
      seq,
      tileRef,
      targetingAlly,
      trajectoryTileRef,
    );
  }

  /**
   * Push a GhostPreviewData snapshot to the WebGL view (StructurePass /
   * RangeCirclePass / RailroadPass / CrosshairPass all read it). null when
   * the ghost can't be placed. smoothLoop interpolates displayed position
   * toward the target tile each frame.
   */
  private emitGhostPreview(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
    trajectoryTileRef: TileRef | undefined,
  ): void {
    const data = this.buildGhostPreviewData(tileRef, targetingAlly);
    if (data === null) {
      this.lastGhostData = null;
      this.prevGhostDataRef = null;
      this.renderedGhostBuffer = null;
      this.view.updateGhostPreview(null);
    } else {
      this.lastGhostData = data;
    }
    // The trajectory target is tracked separately from the ghost tile:
    // impassable terrain voids the ghost but still gets a trajectory arc.
    this.updateNukeTrajectoryPreview(trajectoryTileRef);
  }

  /**
   * For AtomBomb / HydrogenBomb ghosts, push the Bezier trajectory preview
   * (closest player-owned silo → target, accounting for non-allied SAMs).
   * Cleared whenever the ghost isn't a nuke, has no target, or the player
   * has no silos. Unlike the ghost icon, the trajectory also renders when
   * hovering impassable terrain (cursorLoop adds the blocked X there).
   */
  private canShowNukeTrajectory(tileRef: TileRef | undefined): boolean {
    if (!this.ghostUnit || tileRef === undefined) return false;
    const type = this.ghostUnit.buildableUnit.type;
    return type === UnitType.AtomBomb || type === UnitType.HydrogenBomb;
  }

  private buildTrajectoryStatic(
    myPlayer: NonNullable<ReturnType<GameView["myPlayer"]>>,
    bestSilo: NonNullable<ReturnType<typeof findBestSilo>>,
    tileRef: TileRef,
  ): NukeTrajectoryStatic {
    this.populateAlliesAndTeammates(myPlayer);
    const type = this.ghostUnit!.buildableUnit.type;
    const betrayedIds = this.getBetrayedAllianceIds(type, tileRef);
    const sams = collectThreateningSams(
      this.game,
      myPlayer,
      this.teammateIds,
      this.allyIds,
      betrayedIds,
    );
    return {
      srcX: this.game.x(bestSilo.tile()),
      srcY: this.game.y(bestSilo.tile()),
      targetTile: tileRef,
      directionUp: this.uiState.rocketDirectionUp,
      sams,
    };
  }

  private updateNukeTrajectoryPreview(tileRef: TileRef | undefined): void {
    const myPlayer = this.game.myPlayer();
    if (!this.canShowNukeTrajectory(tileRef) || !myPlayer) {
      this.clearNukeTrajectory();
      return;
    }
    const bestSilo = findBestSilo(
      myPlayer,
      this.game,
      this.game.x(tileRef!),
      this.game.y(tileRef!),
    );
    if (!bestSilo) {
      this.clearNukeTrajectory();
      return;
    }
    const next = this.buildTrajectoryStatic(myPlayer, bestSilo, tileRef!);
    if (!isTrajectoryEqual(this.nukeTrajectoryStatic, next)) {
      this.nukeTrajectoryStatic = next;
    }
  }

  private populateAlliesAndTeammates(
    myPlayer: NonNullable<ReturnType<GameView["myPlayer"]>>,
  ): void {
    this.teammateIds.clear();
    for (const p of this.game.players()) {
      if (myPlayer.isOnSameTeam(p)) this.teammateIds.add(p.smallID());
    }
    this.allyIds.clear();
    for (const a of myPlayer.allies()) this.allyIds.add(a.smallID());
  }

  private getBetrayedAllianceIds(
    unitType: UnitType,
    targetTile: TileRef,
  ): ReadonlySet<number> {
    if (this.allyIds.size === 0) return EMPTY_ID_SET;
    return listNukeBreakAlliance({
      game: this.game,
      targetTile,
      magnitude: this.game.config().nukeMagnitudes(unitType),
      threshold: this.game.config().nukeAllianceBreakThreshold(),
    });
  }

  private clearNukeTrajectory(): void {
    this.nukeTrajectoryStatic = null;
    this.prevTrajRef = null;
    this.view.updateNukeTrajectory(null);
  }

  private resolveGhostRangeRadius(u: BuildableUnit): number {
    switch (u.type) {
      case UnitType.SAMLauncher: {
        const level = this.resolveGhostRangeLevel(u) ?? 1;
        return this.game.config().samRange(level);
      }
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return this.game.config().nukeMagnitudes(u.type).outer;
      case UnitType.Factory:
        return this.game.config().trainStationMaxRange();
      case UnitType.DefensePost:
        return this.game.config().defensePostRange();
      default:
        return 0;
    }
  }

  // With snapping on, a new structure's preview sits on the tile it will
  // actually be built on (the sim moves it off nearby buildings) instead of
  // under the cursor.
  private resolveGhostPlacement(
    u: BuildableUnit,
    tileRef: TileRef,
  ): { placementTile: TileRef; snapToPlacement: boolean } {
    const placementTile =
      this.userSettings?.snapBuildPreview?.() &&
      u.canUpgrade === false &&
      Structures.has(u.type) &&
      u.canBuild !== false
        ? u.canBuild
        : tileRef;
    return { placementTile, snapToPlacement: placementTile !== tileRef };
  }

  private resolveGhostAffordability(
    myPlayer: NonNullable<ReturnType<GameView["myPlayer"]>>,
    u: BuildableUnit,
  ): { cost: number; multiplier: number; canAfford: boolean } {
    const isNuke = u.type === UnitType.AtomBomb;
    const multiplier =
      u.canUpgrade !== false || isNuke
        ? (this.uiState.upgradeMultiplier ?? 1)
        : 1;
    const cost = bulkCost(u, multiplier);
    let canAfford = myPlayer.gold() >= cost;
    if (isNuke) {
      canAfford &&= myPlayer.readyMissileCount() >= multiplier;
    }
    return { cost: Number(cost), multiplier, canAfford };
  }

  private resolveGhostRadiusCenter(
    placementTile: TileRef,
    rangeRadius: number,
    canUpgrade: boolean,
    upgradeTargetTile: number | null,
  ): { radiusTileX: number; radiusTileY: number } {
    if (rangeRadius > 0 && canUpgrade && upgradeTargetTile !== null) {
      return {
        radiusTileX: this.game.x(upgradeTargetTile),
        radiusTileY: this.game.y(upgradeTargetTile),
      };
    }
    return {
      radiusTileX: this.game.x(placementTile),
      radiusTileY: this.game.y(placementTile),
    };
  }

  private buildGhostPreviewData(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): GhostPreviewData | null {
    if (!this.ghostUnit || tileRef === undefined) return null;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const u = this.effectiveBuildableUnit();
    if (!u) return null;
    const { placementTile, snapToPlacement } = this.resolveGhostPlacement(
      u,
      tileRef,
    );
    const upgradeTargetTile =
      u.canUpgrade !== false
        ? (this.game.unit(u.canUpgrade)?.tile() ?? null)
        : null;
    const rangeRadius = this.resolveGhostRangeRadius(u);
    const { radiusTileX, radiusTileY } = this.resolveGhostRadiusCenter(
      placementTile,
      rangeRadius,
      u.canUpgrade !== false,
      upgradeTargetTile,
    );
    const { cost, multiplier, canAfford } = this.resolveGhostAffordability(
      myPlayer,
      u,
    );

    const next: GhostPreviewData = {
      ghostType: u.type,
      tileX: this.game.x(placementTile),
      tileY: this.game.y(placementTile),
      snapToPlacement,
      radiusTileX,
      radiusTileY,
      canBuild: u.canBuild !== false,
      canUpgrade: u.canUpgrade !== false,
      cost,
      multiplier,
      showCost: this.userSettings.cursorCostLabel(),
      canAfford,
      ghostRailPaths: u.canUpgrade === false ? u.ghostRailPaths : [],
      overlappingRailroads:
        u.canUpgrade === false ? u.overlappingRailroads : [],
      ownerID: myPlayer.smallID(),
      upgradeTargetTile,
      rangeRadius,
      rangeWarning: targetingAlly,
    };

    if (
      this.lastGhostData !== null &&
      isGhostDataEqual(this.lastGhostData, next)
    ) {
      return this.lastGhostData;
    }
    return next;
  }

  private effectiveBuildableUnit(
    preventStacking = this.uiState.preventStacking,
  ): BuildableUnit | null {
    const unit = this.ghostUnit?.buildableUnit;
    if (!unit) return null;
    return preventStacking
      ? { ...unit, canUpgrade: false, upgradeCosts: undefined }
      : unit;
  }

  private isGhostReadyForConfirm(
    preventStacking = this.uiState.preventStacking,
  ): boolean {
    const unit = this.effectiveBuildableUnit(preventStacking);
    return (
      unit !== null && (unit.canBuild !== false || unit.canUpgrade !== false)
    );
  }

  private requestConfirmStructure(e: MouseUpEvent): void {
    this.syncGhostState();
    if (!this.ghostUnit && !this.uiState.ghostStructure) return;
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
    const position = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    // A release just outside the map has no tile to validate or build on.
    if (!this.game.isValidCoord(position.x, position.y)) {
      this.pendingConfirm = null;
      return;
    }
    const tile = this.game.ref(position.x, position.y);
    if (this.game.isImpassable && this.game.isImpassable(tile)) {
      this.pendingConfirm = null;
      return;
    }
    const preventStacking = !!this.uiState.preventStacking;
    if (this.ghostResolved && this.resolvedGhostTile === tile) {
      if (this.isGhostReadyForConfirm(preventStacking)) {
        this.createStructure(tile, preventStacking);
      }
      return;
    }
    // Cache the world tile, not screen coordinates: camera and pointer movement
    // must not retarget a click while the worker validates its placement.
    this.pendingConfirm = {
      tile,
      preventStacking,
    };
    if (this.isQueryInFlight) {
      if (tile !== this.lastQueriedTileRef) {
        this.pendingTileRef = tile;
      }
      return;
    }
    this.lastGhostQueryAt = -Infinity;
    this.renderGhost();
  }

  private createStructure(
    targetTile: TileRef,
    preventStacking = this.uiState.preventStacking,
  ) {
    const unit = this.effectiveBuildableUnit(preventStacking);
    if (!unit || (unit.canBuild === false && unit.canUpgrade === false)) return;
    if (unit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          unit.canUpgrade,
          unit.type,
          this.uiState.upgradeMultiplier || 1,
        ),
      );
      this.removeGhostStructure();
    } else if (unit.canBuild !== false) {
      const unitType = unit.type;

      if (this.shouldBlockRecentAllyNuke(targetTile, unitType)) {
        return;
      }

      const isNuke = unitType === UnitType.AtomBomb;
      const rocketDirectionUp =
        unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      this.eventBus.emit(
        new BuildUnitIntentEvent(
          unitType,
          targetTile,
          rocketDirectionUp,
          isNuke ? this.uiState.upgradeMultiplier || 1 : undefined,
        ),
      );
      // Ghost stays selected for repeated placement (Escape clears it) when
      // the player turned that on for this type in settings.
      if (!this.userSettings.keepBuildSelected(unitType)) {
        this.removeGhostStructure();
      }
    } else {
      this.removeGhostStructure();
    }
  }

  private shouldBlockRecentAllyNuke(
    tile: TileRef,
    unitType: UnitType,
  ): boolean {
    const duration = this.userSettings.nukeAllianceSafetyDuration();
    if (
      duration <= 0 ||
      (unitType !== UnitType.AtomBomb &&
        unitType !== UnitType.HydrogenBomb &&
        unitType !== UnitType.MIRV)
    ) {
      return false;
    }

    const alliances = this.game.myPlayer()?.alliances();
    if (!alliances?.length) return false;

    const currentTick = this.game.ticks();
    const freshAllies = new Map<number, number>();
    for (const a of alliances) {
      if (
        !this.usedSafetyAllies.has(a.id) &&
        currentTick - a.createdAt <= duration
      ) {
        freshAllies.set(this.game.player(a.other).smallID(), a.id);
      }
    }
    if (freshAllies.size === 0) return false;

    const broken =
      unitType === UnitType.MIRV
        ? [this.game.ownerID(tile)]
        : listNukeBreakAlliance({
            game: this.game,
            targetTile: tile,
            magnitude: this.game.config().nukeMagnitudes(unitType),
            threshold: this.game.config().nukeAllianceBreakThreshold(),
          });

    let blocked = false;
    for (const smallId of broken) {
      const allianceId = freshAllies.get(smallId);
      if (allianceId !== undefined) {
        this.usedSafetyAllies.add(allianceId);
        blocked = true;
      }
    }

    if (blocked) {
      this.view.triggerBlockedFlash(
        this.game.x(tile) + 0.5,
        this.game.y(tile) + 0.5,
      );
    }
    return blocked;
  }

  private moveGhost(e: MouseMoveEvent): void {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
    this.syncGhostState();
    if (!this.ghostUnit) return;

    if (this.pendingConfirm !== null) {
      if (this.pendingConfirm.tile !== this.lastQueriedTileRef) {
        return;
      }
    }

    const currentTile = this.getHoveredTile();
    if (currentTile !== this.lastQueriedTileRef) {
      if (!this.isQueryInFlight) {
        this.lastQueriedTileRef = currentTile;
        this.pendingTileRef = null;
        this.renderGhost();
      } else {
        this.pendingTileRef = currentTile;
      }
    } else if (this.isQueryInFlight && this.pendingTileRef !== null) {
      this.pendingTileRef = null;
    }
  }

  private createGhostStructure(type: PlayerBuildableUnitType | null) {
    if (type === null) return;
    if (this.game.myPlayer() === null) return;
    this.ghostResolved = false;
    this.resolvedGhostTile = undefined;
    this.resetCursorCaches();
    this.ghostUnit = {
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };
  }

  private clearGhostStructure(): void {
    this.querySeq++;
    this.isQueryInFlight = false;
    this.lastQueriedTileRef = undefined;
    this.pendingTileRef = null;
    this.pendingConfirm = null;
    this.ghostResolved = false;
    this.resolvedGhostTile = undefined;
    this.ghostUnit = null;
    this.lastGhostData = null;
    this.renderedGhostBuffer = null;
    this.resetCursorCaches();
    this.view.updateGhostPreview(null);
    this.clearNukeTrajectory();
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
  }

  private resolveGhostRangeLevel(
    buildableUnit: BuildableUnit,
  ): number | undefined {
    if (buildableUnit.type !== UnitType.SAMLauncher) return undefined;
    if (buildableUnit.canUpgrade !== false) {
      const existing = this.game.unit(buildableUnit.canUpgrade);
      if (existing) {
        return existing.level() + 1;
      } else {
        console.warn("Failed to find existing SAMLauncher for upgrade");
      }
    }
    return 1;
  }
}
