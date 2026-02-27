import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder, SegmentPlan } from "../types";

/**
 * Wraps a PathFinder to handle shore tiles.
 * Coerces shore tiles to nearby water tiles before pathfinding,
 * then fixes the path extremes to include the original shore tiles.
 */
export class ShoreCoercingTransformer implements PathFinder<number> {
  private lastPlanFrom: TileRef | TileRef[] | null = null;
  private lastPlanTo: TileRef | null = null;
  private lastPlan: SegmentPlan | null = null;

  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    const fromArray = Array.isArray(from) ? from : [from];
    const waterToOriginal = new Map<TileRef, TileRef | null>();
    const waterFrom: TileRef[] = [];

    for (const f of fromArray) {
      const coerced = this.coerceToWater(f);
      if (coerced.water !== null) {
        waterFrom.push(coerced.water);
        waterToOriginal.set(coerced.water, coerced.original);
      }
    }

    if (waterFrom.length === 0) {
      return null;
    }

    const coercedTo = this.coerceToWater(to);
    if (coercedTo.water === null) {
      return null;
    }

    const fromTiles = waterFrom.length === 1 ? waterFrom[0] : waterFrom;
    const path = this.inner.findPath(fromTiles, coercedTo.water);
    if (!path || path.length === 0) {
      this.lastPlanFrom = from;
      this.lastPlanTo = to;
      this.lastPlan = null;
      return null;
    }

    const innerPlan = this.inner.planSegments?.(fromTiles, coercedTo.water);
    const planPoints: number[] | null = innerPlan
      ? Array.from(innerPlan.points)
      : null;
    const planSteps: number[] | null = innerPlan
      ? Array.from(innerPlan.segmentSteps)
      : null;

    // Restore original start shore tile
    const originalShore = waterToOriginal.get(path[0]);
    if (originalShore !== undefined && originalShore !== null) {
      path.unshift(originalShore);
      if (planPoints && planSteps) {
        planPoints.unshift(originalShore >>> 0);
        planSteps.unshift(1);
      }
    }

    // Append original to if different
    if (
      coercedTo.original !== null &&
      path[path.length - 1] !== coercedTo.original
    ) {
      path.push(coercedTo.original);
      if (planPoints && planSteps) {
        planPoints.push(coercedTo.original >>> 0);
        planSteps.push(1);
      }
    }

    this.lastPlanFrom = from;
    this.lastPlanTo = to;
    this.lastPlan =
      planPoints && planSteps
        ? {
            points: Uint32Array.from(planPoints),
            segmentSteps: Uint32Array.from(planSteps),
          }
        : null;

    return path;
  }

  planSegments(from: TileRef | TileRef[], to: TileRef): SegmentPlan | null {
    if (this.lastPlanFrom === from && this.lastPlanTo === to) {
      return this.lastPlan;
    }

    this.findPath(from, to);
    return this.lastPlan;
  }

  /**
   * Coerce a tile to water for pathfinding.
   * If tile is already water, returns it unchanged.
   * If tile is shore, finds the best adjacent water neighbor.
   */
  private coerceToWater(tile: TileRef): {
    water: TileRef | null;
    original: TileRef | null;
  } {
    if (this.map.isWater(tile)) {
      return { water: tile, original: null };
    }

    let best: TileRef | null = null;
    let maxScore = -1;

    for (const n of this.map.neighbors(tile)) {
      if (!this.map.isWater(n)) continue;

      // Score by water neighbor count (connectivity)
      const score = this.countWaterNeighbors(n);

      // Pick highest connectivity
      if (score > maxScore) {
        maxScore = score;
        best = n;
      }
    }

    if (best !== null) {
      return { water: best, original: tile };
    }
    return { water: null, original: tile };
  }

  private countWaterNeighbors(tile: TileRef): number {
    let count = 0;
    for (const n of this.map.neighbors(tile)) {
      if (this.map.isWater(n)) count++;
    }
    return count;
  }
}
