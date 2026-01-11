// Shore-coercing transformer that converts shore tiles to water tiles for pathfinding

import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";

/**
 * Wraps a PathFinder to handle shore tiles.
 * Coerces shore tiles to nearby water tiles before pathfinding,
 * then fixes the path extremes to include the original shore tiles.
 *
 * Works at whatever resolution the map provides - can be used with
 * full map or minimap-based pathfinders.
 */
export class ShoreCoercingTransformer implements PathFinder<number> {
  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    // Coerce from tiles
    const fromArray = Array.isArray(from) ? from : [from];
    const coercedFromArray: Array<{
      water: TileRef;
      original: TileRef | null;
    }> = [];

    for (const f of fromArray) {
      const coerced = this.coerceToWater(f);
      if (coerced.water !== null) {
        coercedFromArray.push({
          water: coerced.water,
          original: coerced.original,
        });
      }
    }

    if (coercedFromArray.length === 0) {
      return null;
    }

    // Coerce to tile
    const coercedTo = this.coerceToWater(to);
    if (coercedTo.water === null) {
      return null;
    }

    // Build water-only from array
    const waterFrom =
      coercedFromArray.length === 1
        ? coercedFromArray[0].water
        : coercedFromArray.map((c) => c.water);

    // Search on water tiles
    const path = this.inner.findPath(waterFrom, coercedTo.water);
    if (!path || path.length === 0) {
      return null;
    }

    // Fix extremes: find which source was used and prepend/append originals
    const result = [...path];

    // Find the original for the source that was used (closest to path start)
    if (coercedFromArray.length > 0) {
      const pathStart = result[0];
      let bestOriginal: TileRef | null = null;
      let minDist = Infinity;

      for (const { water, original } of coercedFromArray) {
        if (original !== null) {
          const dist = this.map.manhattanDist(pathStart, water);
          if (dist < minDist) {
            minDist = dist;
            bestOriginal = original;
          }
        }
      }

      // Prepend original if we have one and it's not already at start
      if (bestOriginal !== null && result[0] !== bestOriginal) {
        result.unshift(bestOriginal);
      }
    }

    // Append original to if different
    if (
      coercedTo.original !== null &&
      result[result.length - 1] !== coercedTo.original
    ) {
      result.push(coercedTo.original);
    }

    return result;
  }

  /**
   * Coerce a tile to water for pathfinding.
   * If tile is already water, returns it unchanged.
   * If tile is shore (land with water neighbor), finds the nearest water neighbor.
   */
  private coerceToWater(tile: TileRef): {
    water: TileRef | null;
    original: TileRef | null;
  } {
    // If already water, no coercion needed
    if (this.map.isWater(tile)) {
      return { water: tile, original: null };
    }

    // Find adjacent water neighbor
    for (const n of this.map.neighbors(tile)) {
      if (this.map.isWater(n)) {
        return { water: n, original: tile };
      }
    }

    // No water neighbor found - let HPA* handle at minimap level
    return { water: null, original: tile };
  }
}
