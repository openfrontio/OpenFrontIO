import type {
  AttackRingInput,
  BonusEvent,
  ConquestFx,
  DeadUnitFx,
  FrameData,
  NameEntry,
  NukeTelegraphData,
  PlayerState,
  PlayerStatusData,
  TilePair,
  UnitState,
} from "../types";

/**
 * Structural interface for the GPU view target.
 * Satisfied by GameView through TypeScript structural typing.
 */
export interface FrameUploadTarget {
  uploadTileAndTrailState(tileState: Uint16Array, trailState: Uint8Array): void;
  uploadLiveDelta(tileState: Uint16Array, changedTiles: TilePair[]): void;
  uploadLiveTrailDelta(
    trailState: Uint8Array,
    dirtyRowMin: number,
    dirtyRowMax: number,
  ): void;
  applyFullTiles(tileState: Uint16Array, trailState: Uint8Array): void;
  applyDelta(changedTiles: TilePair[], trailState: Uint8Array): void;
  uploadRailroadState(data: Uint8Array): void;
  applyRailroadDust(tileRefs: number[]): void;
  updateUnits(units: ReadonlyMap<number, UnitState>, gameTick: number): void;
  updateStructures(units: ReadonlyMap<number, UnitState>): void;
  applyDeadUnits(deadUnits: DeadUnitFx[]): void;
  applyConquestEvents(events: ConquestFx[]): void;
  applyBonusEvents(events: BonusEvent[]): void;
  updateAttackRings(rings: AttackRingInput[]): void;
  updateNukeTelegraphs(data: NukeTelegraphData[]): void;
  updateNames(
    names: ReadonlyMap<string, NameEntry>,
    players: ReadonlyMap<number, PlayerState>,
    snap: boolean,
    statusData?: ReadonlyMap<number, PlayerStatusData>,
  ): void;
  updateRelations(data: Uint8Array, size: number): void;
  setSAMAllianceClusters(clusters: ReadonlyMap<number, number>): void;
}

export interface UploadOptions {
  /** Snap name positions instantly (seek mode). Default: false. */
  snap?: boolean;
  /** Skip tile upload — caller already handled tiles (e.g. seek with bloom reset). */
  skipTileUpload?: boolean;
}

/**
 * Upload a FrameData snapshot to the GPU view.
 *
 * Handles tile upload mode switching, all view update calls, and conditional
 * railroad/ephemeral uploads. The FrameData itself carries semantic differences
 * (seek sets deadUnits=[], conquestEvents=[] etc.) — this function is a
 * straightforward dispatch loop.
 */
export function uploadFrameData(
  view: FrameUploadTarget,
  frame: FrameData,
  opts?: UploadOptions,
): void {
  const snap = opts?.snap ?? false;
  const skipTileUpload = opts?.skipTileUpload ?? false;

  // --- Tiles + Trails ---
  // Live mode: changedTiles[] means "only these tiles changed" (empty = nothing changed, skip upload).
  //            changedTiles null/undefined means "no delta info" (first tick — full upload needed).
  // Copy mode: changedTiles[] = delta playback, null = full seek.
  if (!skipTileUpload) {
    if (frame.tileMode === "live" && frame.changedTiles) {
      // Live delta path — tiles and trails uploaded independently
      if (frame.changedTiles.length > 0) {
        view.uploadLiveDelta(frame.tileState, frame.changedTiles);
      }
      // Trail dirty rows come from TrailManager, independent of tile deltas
      if (frame.trailDirtyRowMax >= 0) {
        view.uploadLiveTrailDelta(
          frame.trailState,
          frame.trailDirtyRowMin,
          frame.trailDirtyRowMax,
        );
      }
    } else if (frame.tileMode === "live") {
      view.uploadTileAndTrailState(frame.tileState, frame.trailState);
    } else if (!frame.changedTiles) {
      view.applyFullTiles(frame.tileState, frame.trailState);
    } else {
      view.applyDelta(frame.changedTiles, frame.trailState);
    }
  }

  // --- Railroads ---
  if (frame.railroadDirty) {
    view.uploadRailroadState(frame.railroadState);
    if (frame.revealedRailTiles.length > 0) {
      view.applyRailroadDust(frame.revealedRailTiles);
    }
  }

  // --- Units + structures ---
  view.updateUnits(frame.units, frame.tick);
  if (frame.structuresDirty) {
    view.updateStructures(frame.units);
  }

  // --- Ephemeral effects ---
  if (frame.events.deadUnits.length > 0) {
    view.applyDeadUnits(frame.events.deadUnits);
  }
  if (frame.events.conquestEvents.length > 0) {
    view.applyConquestEvents(frame.events.conquestEvents);
  }
  if (frame.events.bonusEvents.length > 0) {
    view.applyBonusEvents(frame.events.bonusEvents);
  }

  // --- Attack rings + nuke telegraphs ---
  view.updateAttackRings(frame.attackRings);
  view.updateNukeTelegraphs(frame.nukeTelegraphs);

  // --- Names + player status ---
  view.updateNames(frame.names, frame.players, snap, frame.playerStatus);

  // --- Relations ---
  view.updateRelations(frame.relationMatrix, frame.relationSize);

  // --- Alliance clusters (SAM pass) ---
  view.setSAMAllianceClusters(frame.allianceClusters);
}
