import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";

/**
 * Wraps a PathFinder to handle shore tiles.
 * Coerces shore tiles to nearby water tiles before pathfinding,
 * then fixes the path extremes to include the original shore tiles.
 */
export class ShoreCoercingTransformer implements PathFinder<number> {
  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    const fromArray = Array.isArray(from) ? from : [from];
    const waterToOriginal = new Map<TileRef, TileRef | null>();
    const waterFrom: TileRef[] = [];

    for (const f of fromArray) {
      const coerced = this.coerceToWater(f, to);
      if (coerced.water !== null) {
        waterFrom.push(coerced.water);
        // Keep first mapping if multiple shores coerce to same water tile
        if (!waterToOriginal.has(coerced.water)) {
          waterToOriginal.set(coerced.water, coerced.original);
        }
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
      return null;
    }

    // Restore original start shore tile
    const startWater = path[0];
    let originalStart = waterToOriginal.get(startWater);

    // Fallback: if inner pathfinder rewrote start, find which shore borders path[0]
    if (originalStart === undefined) {
      for (const f of fromArray) {
        if (this.map.isWater(f)) continue;
        for (const n of this.map.neighbors(f)) {
          if (n === startWater) {
            originalStart = f;
            break;
          }
        }
        if (originalStart !== undefined) break;
      }
    }

    if (originalStart !== undefined && originalStart !== null) {
      path.unshift(originalStart);
    }

    // Append original to if different
    if (
      coercedTo.original !== null &&
      path[path.length - 1] !== coercedTo.original
    ) {
      path.push(coercedTo.original);
    }

    return path;
  }

  /**
   * Coerce a tile to water for pathfinding.
   * If tile is already water, returns it unchanged.
   * If tile is shore, finds the best adjacent water neighbor.
   */
  private coerceToWater(
    tile: TileRef,
    destination?: TileRef,
  ): {
    water: TileRef | null;
    original: TileRef | null;
  } {
    if (this.map.isWater(tile)) {
      return { water: tile, original: null };
    }

    let best: TileRef | null = null;
    let maxScore = -1;
    let minDist = Infinity;

    for (const n of this.map.neighbors(tile)) {
      if (!this.map.isWater(n)) continue;

      // Score by water neighbor count (connectivity)
      const score = this.countWaterNeighbors(n);
      const dist =
        destination !== undefined
          ? this.map.euclideanDistSquared(n, destination)
          : 0;

      // Pick highest connectivity, then closest to destination
      if (score > maxScore || (score === maxScore && dist < minDist)) {
        maxScore = score;
        minDist = dist;
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
