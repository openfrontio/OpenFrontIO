import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";

/**
 * Wraps a PathFinder to handle shore tiles.
 * Coerces shore tiles to nearby water tiles before pathfinding,
 * then fixes the path extremes to include the original shore tiles.
 */
// Reusable neighbor buffers; the simulation is single-threaded and both are
// fully consumed before any re-entrant call.
const NEIGHBOR_SCRATCH: TileRef[] = [0, 0, 0, 0];
const NEIGHBOR_SCRATCH_INNER: TileRef[] = [0, 0, 0, 0];

export class ShoreCoercingTransformer implements PathFinder<number> {
  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    const fromArray = Array.isArray(from) ? from : [from];
    const waterToOriginal = new Map<TileRef, TileRef>();
    const waterFrom: TileRef[] = [];

    for (const f of fromArray) {
      if (this.map.isWater(f)) {
        waterFrom.push(f);
        // A raw water source needs no shore restoration — and overrides any
        // earlier shore tile that coerced to this same water tile (last
        // write wins, matching processing order).
        waterToOriginal.delete(f);
      } else {
        const water = this.bestWaterNeighbor(f);
        if (water !== -1) {
          waterFrom.push(water);
          waterToOriginal.set(water, f);
        }
      }
    }

    if (waterFrom.length === 0) {
      return null;
    }

    // Coerce the destination: shore tiles path to their best water neighbor,
    // with the original appended back afterwards.
    let waterTo = to;
    let originalTo: TileRef = -1;
    if (!this.map.isWater(to)) {
      waterTo = this.bestWaterNeighbor(to);
      if (waterTo === -1) {
        return null;
      }
      originalTo = to;
    }

    const fromTiles = waterFrom.length === 1 ? waterFrom[0] : waterFrom;
    const path = this.inner.findPath(fromTiles, waterTo);
    if (!path || path.length === 0) {
      return null;
    }

    // Restore original start shore tile
    const originalShore = waterToOriginal.get(path[0]);
    if (originalShore !== undefined) {
      path.unshift(originalShore);
    }

    // Append original to if different
    if (originalTo !== -1 && path[path.length - 1] !== originalTo) {
      path.push(originalTo);
    }

    return path;
  }

  /**
   * Best adjacent water neighbor of a shore tile (highest water-neighbor
   * connectivity, first wins on ties), or -1 if it has none.
   */
  private bestWaterNeighbor(tile: TileRef): TileRef {
    let best: TileRef = -1;
    let maxScore = -1;

    const nbuf = NEIGHBOR_SCRATCH;
    const numNeighbors = this.map.neighbors4(tile, nbuf);
    for (let i = 0; i < numNeighbors; i++) {
      const n = nbuf[i];
      if (!this.map.isWater(n)) continue;

      // Score by water neighbor count (connectivity)
      const score = this.countWaterNeighbors(n);

      // Pick highest connectivity
      if (score > maxScore) {
        maxScore = score;
        best = n;
      }
    }

    return best;
  }

  private countWaterNeighbors(tile: TileRef): number {
    let count = 0;
    const nbuf = NEIGHBOR_SCRATCH_INNER;
    const numNeighbors = this.map.neighbors4(tile, nbuf);
    for (let i = 0; i < numNeighbors; i++) {
      if (this.map.isWater(nbuf[i])) count++;
    }
    return count;
  }
}
