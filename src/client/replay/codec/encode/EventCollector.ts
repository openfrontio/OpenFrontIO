/**
 * Collects the replay's event lists (ReplayEvents) from normalized
 * frames. The viewer uses them to rebuild things a frame doesn't carry
 * when it seeks: the rail network, dead-unit FX, nuke telegraphs and
 * destroyed map layers.
 */

import {
  GameUpdateType,
  type RailroadConstructionUpdate,
  type RailroadDestructionUpdate,
  type RailroadSnapUpdate,
  type SpawnPhaseEndUpdate,
  type UnitUpdate,
} from "../../../../core/game/GameUpdates";
import type { NormalizedFrame } from "../FrameNormalizer";
import {
  RailroadEventKind,
  type ConstructionStartEvent,
  type DeadUnitEvent,
  type NukeImpactEvent,
  type RailroadEvent,
  type ReplayMotionPlan,
  type SpawnPhaseEndEvent,
} from "../ReplayTypes";

export class EventCollector {
  readonly nukeImpacts: NukeImpactEvent[] = [];
  readonly railroadEvents: RailroadEvent[] = [];
  readonly motionPlans: ReplayMotionPlan[] = [];
  readonly constructionStarts: ConstructionStartEvent[] = [];
  readonly deadUnitEvents: DeadUnitEvent[] = [];
  spawnPhaseEnd: SpawnPhaseEndEvent | null = null;

  private constructing = new Set<number>();

  /** `isLand`: whether a tile is land after this frame's tick. */
  push(frame: NormalizedFrame, isLand: (ref: number) => boolean): void {
    const { tick, source: gu } = frame;

    const spawnEnd = gu.updates[
      GameUpdateType.SpawnPhaseEnd
    ] as SpawnPhaseEndUpdate[];
    if (spawnEnd.length > 0 && this.spawnPhaseEnd === null) {
      this.spawnPhaseEnd = { tick, startTick: spawnEnd[0].startTick };
    }

    if (gu.packedNukeImpacts !== undefined && gu.packedNukeImpacts.length > 0) {
      const impact: NukeImpactEvent = { tick, land: [], water: [] };
      for (const ref of gu.packedNukeImpacts) {
        (isLand(ref) ? impact.land : impact.water).push(ref);
      }
      this.nukeImpacts.push(impact);
    }

    for (const u of gu.updates[
      GameUpdateType.RailroadDestructionEvent
    ] as RailroadDestructionUpdate[]) {
      this.railroadEvents.push({
        tick,
        kind: RailroadEventKind.Destruction,
        id: u.id,
      });
    }
    for (const u of gu.updates[
      GameUpdateType.RailroadConstructionEvent
    ] as RailroadConstructionUpdate[]) {
      this.railroadEvents.push({
        tick,
        kind: RailroadEventKind.Construction,
        id: u.id,
        tiles: u.tiles.slice(),
      });
    }
    for (const u of gu.updates[
      GameUpdateType.RailroadSnapEvent
    ] as RailroadSnapUpdate[]) {
      this.railroadEvents.push({
        tick,
        kind: RailroadEventKind.Snap,
        originalId: u.originalId,
        newId1: u.newId1,
        newId2: u.newId2,
        tiles1: u.tiles1.slice(),
        tiles2: u.tiles2.slice(),
      });
    }

    // Positions are already resolved per frame. The viewer only needs to
    // know when each grid plan arrived, for the nuke telegraphs.
    for (const rec of frame.motionPlans) {
      if (rec.kind !== "grid") continue;
      this.motionPlans.push({
        tick,
        unitId: rec.unitId,
        startTick: rec.startTick,
      });
    }

    for (const u of frame.units) {
      if (u.underConstruction && u.isActive) {
        if (!this.constructing.has(u.id)) {
          this.constructing.add(u.id);
          this.constructionStarts.push({ unitId: u.id, startTick: tick });
        }
      } else {
        this.constructing.delete(u.id);
      }
    }
    // Read from the raw updates like GameView does: a planned unit's last
    // update has where it actually ended up (a nuke's target), while the
    // normalized state is still on the plan's path.
    for (const u of gu.updates[GameUpdateType.Unit] as UnitUpdate[]) {
      if (u.isActive) continue;
      this.deadUnitEvents.push({
        tick,
        unitId: u.id,
        unitType: u.unitType,
        ownerSmallID: u.ownerID,
        pos: u.pos,
        reachedTarget: u.reachedTarget,
      });
    }
  }
}
