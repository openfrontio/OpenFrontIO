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

    // Coerce to tile
    const coercedTo = this.coerceToWater(to);
    if (coercedTo.water === null) {
      return null;
    }

    // Search on water tiles
    const path = this.inner.findPath(waterFrom, coercedTo.water);
    if (!path || path.length === 0) {
      return null;
    }

    // Look up the actual path start in the map
    const originalShore = waterToOriginal.get(path[0]);
    if (originalShore !== undefined && originalShore !== null) {
      path.unshift(originalShore);
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
