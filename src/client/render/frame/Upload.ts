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

/**
 * Upload a FrameData snapshot to the GPU view.
 *
 * A straightforward dispatch loop: pushes tile/trail deltas, then all the
 * conditional railroad/ephemeral uploads, to the view's update*() methods.
 */
export function uploadFrameData(
  view: FrameUploadTarget,
  frame: FrameData,
): void {
  // --- Tiles + Trails ---
  // changedTiles[] means "only these tiles changed" (empty = nothing changed,
  // skip upload). null means "no delta info" (first tick — full upload needed).
  if (frame.changedTiles) {
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
  } else {
    view.uploadTileAndTrailState(frame.tileState, frame.trailState);
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
  view.updateNames(frame.names, frame.players, false, frame.playerStatus);

  // --- Relations ---
  // Gated: updateRelations triggers a full-map border recompute downstream,
  // so only push when the matrix was actually rebuilt this tick.
  if (frame.relationsDirty) {
    view.updateRelations(frame.relationMatrix, frame.relationSize);
  }

  // --- Alliance clusters (SAM pass) ---
  view.setSAMAllianceClusters(frame.allianceClusters);
}
