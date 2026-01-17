import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";

type Coerced = { water: TileRef | null; original: TileRef | null };

/**
 * Coerces shore/land endpoints to adjacent water tiles for pathfinding,
 * then restores original shore tiles to the returned path.
 */
export class ShoreCoercingTransformer implements PathFinder<number> {
  constructor(
    private readonly inner: PathFinder<number>,
    private readonly map: GameMap,
    private readonly findBestShoreNeighbor: boolean = true,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    const fromArray = Array.isArray(from) ? from : [from];
    const waterToOriginal = new Map<TileRef, TileRef | null>();
    const waterFrom: TileRef[] = [];

    for (const f of fromArray) {
      const { water, original } = this.coerceToWater(f, to);
      if (water !== null) {
        waterFrom.push(water);
        // Keep first mapping if multiple shores coerce to same water tile
        if (!waterToOriginal.has(water)) waterToOriginal.set(water, original);
      }
    }

    if (!waterFrom.length) return null;

    const coercedTo = this.coerceToWater(to);
    if (coercedTo.water === null) return null;

    const path = this.inner.findPath(
      waterFrom.length === 1 ? waterFrom[0] : waterFrom,
      coercedTo.water,
    );
    if (!path?.length) return null;

    // Restore original shore endpoints to the path
    const originalStart = this.resolveOriginalStart(
      path[0],
      fromArray,
      waterToOriginal,
    );
    if (originalStart !== null) path.unshift(originalStart);

    if (coercedTo.original !== null && path.at(-1) !== coercedTo.original) {
      path.push(coercedTo.original);
    }

    return path;
  }

  /**
   * Finds the original shore tile for a given start water tile.
   * Falls back to neighbor search if inner pathfinder rewrote the start tile.
   */
  private resolveOriginalStart(
    startWater: TileRef,
    candidates: TileRef[],
    mapping: Map<TileRef, TileRef | null>,
  ): TileRef | null {
    const mapped = mapping.get(startWater);
    if (mapped !== undefined) return mapped;

    // Fallback: find which candidate shore borders the start water tile
    for (const f of candidates) {
      if (this.map.isWater(f)) continue;
      for (const n of this.map.neighbors(f)) {
        if (n === startWater) return f;
      }
    }
    return null;
  }

  /** Coerces land tiles to an adjacent water tile; water tiles pass through unchanged. */
  private coerceToWater(tile: TileRef, destination?: TileRef): Coerced {
    if (this.map.isWater(tile)) return { water: tile, original: null };

    let best: TileRef | null = null;
    let maxScore = -1;
    let minDist = Infinity;

    for (const n of this.map.neighbors(tile)) {
      if (!this.map.isWater(n)) continue;
      if (!this.findBestShoreNeighbor) return { water: n, original: tile };

      // Prefer water tiles with more water neighbors (better connectivity)
      const score = this.countWaterNeighbors(n);
      const dist =
        destination !== null && destination !== undefined
          ? this.map.euclideanDistSquared(n, destination)
          : 0;

      // Highest connectivity, then closest to destination
      if (score > maxScore || (score === maxScore && dist < minDist)) {
        maxScore = score;
        minDist = dist;
        best = n;
      }
    }

    return { water: best, original: tile };
  }

  private countWaterNeighbors(tile: TileRef): number {
    let count = 0;
    for (const n of this.map.neighbors(tile)) {
      if (this.map.isWater(n)) count++;
    }
    return count;
  }
}
