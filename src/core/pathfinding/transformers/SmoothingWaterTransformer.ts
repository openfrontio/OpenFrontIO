import { GameMap, TileRef } from "../../game/GameMap";
import { DebugSpan } from "../../utilities/DebugSpan";
import {
  AStarWaterBounded,
  SearchBounds,
} from "../algorithms/AStar.WaterBounded";
import { PathFinder } from "../types";

const ENDPOINT_REFINEMENT_TILES = 50;
const LOCAL_ASTAR_MAX_AREA = 100 * 100;
const LOS_MIN_MAGNITUDE = 3;
const MAGNITUDE_MASK = 0x1f;

/**
 * Water path smoother transformer with two passes:
 * 1. Binary search LOS smoothing (avoids shallow water)
 * 2. Local A* refinement on endpoints (first/last N tiles)
 */
export class SmoothingWaterTransformer implements PathFinder<TileRef> {
  private readonly mapWidth: number;
  private readonly localAStar: AStarWaterBounded;
  private readonly terrain: Uint8Array;
  private readonly isTraversable: (tile: TileRef) => boolean;

  constructor(
    private inner: PathFinder<TileRef>,
    private map: GameMap,
    isTraversable: (tile: TileRef) => boolean = (t) => map.isWater(t),
  ) {
    this.mapWidth = map.width();
    this.localAStar = new AStarWaterBounded(map, LOCAL_ASTAR_MAX_AREA);
    this.terrain = (map as any).terrain as Uint8Array;
    this.isTraversable = isTraversable;
  }

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    const path = this.inner.findPath(from, to);

    return DebugSpan.wrap("smoothingTransformer", () =>
      path ? this.smooth(path) : null,
    );
  }

  private smooth(path: TileRef[]): TileRef[] {
    if (path.length <= 2) {
      return path;
    }

    // Pass 1: LOS smoothing with binary search
    let smoothed = DebugSpan.wrap("smoother:los", () => this.losSmooth(path));

    // Pass 2: Local A* refinement on endpoints
    smoothed = DebugSpan.wrap("smoother:refine", () =>
      this.refineEndpoints(smoothed),
    );

    return smoothed;
  }

  private losSmooth(path: TileRef[]): TileRef[] {
    const result: TileRef[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      // Binary search for farthest visible waypoint
      let lo = current + 1;
      let hi = path.length - 1;
      let farthest = lo;

      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (this.canSee(path[current], path[mid])) {
          farthest = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      // Trace the path to farthest visible point
      if (farthest > current + 1) {
        const trace = this.tracePath(path[current], path[farthest]);
        if (trace) {
          // Add all intermediate tiles except the last (will be added in next iteration or at end)
          for (let i = 1; i < trace.length - 1; i++) {
            result.push(trace[i]);
          }
        }
      }

      current = farthest;
      if (current < path.length - 1) {
        result.push(path[current]);
      }
    }

    result.push(path[path.length - 1]);
    return result;
  }

  private refineEndpoints(path: TileRef[]): TileRef[] {
    if (path.length <= 2) {
      return path;
    }

    const refineDist = ENDPOINT_REFINEMENT_TILES;
    let result = path;

    // Find the index where cumulative distance reaches refineDist from start
    const startEndIdx = this.findTileAtDistance(path, 0, refineDist, true);

    // Refine start segment if it's more than 2 tiles and not already optimal
    if (startEndIdx > 1) {
      const startSegment = this.refineSegment(path[0], path[startEndIdx]);

      if (startSegment && startSegment.length > 0) {
        result = [...startSegment.slice(0, -1), ...result.slice(startEndIdx)];
      }
    }

    // Find the index where cumulative distance reaches refineDist from end
    const endStartIdx = this.findTileAtDistance(
      result,
      result.length - 1,
      refineDist,
      false,
    );

    // Refine end segment if it's more than 2 tiles and not already optimal
    // Search in reverse (from destination backwards) so path approaches target naturally
    if (endStartIdx < result.length - 2) {
      const endSegment = this.refineSegment(
        result[result.length - 1],
        result[endStartIdx],
      );

      if (endSegment && endSegment.length > 0) {
        endSegment.reverse();
        result = [...result.slice(0, endStartIdx), ...endSegment];
      }
    }

    return result;
  }

  private findTileAtDistance(
    path: TileRef[],
    startIdx: number,
    distance: number,
    forward: boolean,
  ): number {
    let cumDist = 0;
    let idx = startIdx;

    if (forward) {
      while (idx < path.length - 1 && cumDist < distance) {
        cumDist += this.manhattanDist(path[idx], path[idx + 1]);
        idx++;
      }
    } else {
      while (idx > 0 && cumDist < distance) {
        cumDist += this.manhattanDist(path[idx], path[idx - 1]);
        idx--;
      }
    }

    return idx;
  }

  private refineSegment(from: TileRef, to: TileRef): TileRef[] | null {
    const x0 = this.map.x(from);
    const y0 = this.map.y(from);
    const x1 = this.map.x(to);
    const y1 = this.map.y(to);

    // Calculate bounds with padding
    const padding = 10;
    const bounds: SearchBounds = {
      minX: Math.max(0, Math.min(x0, x1) - padding),
      maxX: Math.min(this.map.width() - 1, Math.max(x0, x1) + padding),
      minY: Math.max(0, Math.min(y0, y1) - padding),
      maxY: Math.min(this.map.height() - 1, Math.max(y0, y1) + padding),
    };

    return this.localAStar.searchBounded(from, to, bounds);
  }

  private canSee(from: TileRef, to: TileRef): boolean {
    const x0 = from % this.mapWidth;
    const y0 = (from / this.mapWidth) | 0;
    const x1 = to % this.mapWidth;
    const y1 = (to / this.mapWidth) | 0;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    const maxTiles = 100000;
    let iterations = 0;

    while (true) {
      if (iterations++ > maxTiles) return false;

      const tile = (y * this.mapWidth + x) as TileRef;
      if (!this.isTraversable(tile)) return false;

      // Check magnitude - avoid shallow water
      const magnitude = this.terrain[tile] & MAGNITUDE_MASK;
      if (magnitude < LOS_MIN_MAGNITUDE) return false;

      if (x === x1 && y === y1) return true;

      const e2 = 2 * err;
      const shouldMoveX = e2 > -dy;
      const shouldMoveY = e2 < dx;

      if (shouldMoveX && shouldMoveY) {
        // Diagonal move - check intermediate tile
        x += sx;
        err -= dy;

        const intermediateTile = (y * this.mapWidth + x) as TileRef;
        const intMag = this.terrain[intermediateTile] & MAGNITUDE_MASK;
        if (
          !this.isTraversable(intermediateTile) ||
          intMag < LOS_MIN_MAGNITUDE
        ) {
          // Try alternative path
          x -= sx;
          err += dy;
          y += sy;
          err += dx;

          const altTile = (y * this.mapWidth + x) as TileRef;
          const altMag = this.terrain[altTile] & MAGNITUDE_MASK;
          if (!this.isTraversable(altTile) || altMag < LOS_MIN_MAGNITUDE)
            return false;

          x += sx;
          err -= dy;
        } else {
          y += sy;
          err += dx;
        }
      } else {
        if (shouldMoveX) {
          x += sx;
          err -= dy;
        }
        if (shouldMoveY) {
          y += sy;
          err += dx;
        }
      }
    }
  }

  private tracePath(from: TileRef, to: TileRef): TileRef[] | null {
    const x0 = from % this.mapWidth;
    const y0 = (from / this.mapWidth) | 0;
    const x1 = to % this.mapWidth;
    const y1 = (to / this.mapWidth) | 0;

    const tiles: TileRef[] = [];

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    const maxTiles = 100000;
    let iterations = 0;

    while (true) {
      if (iterations++ > maxTiles) return null;

      const tile = (y * this.mapWidth + x) as TileRef;
      if (!this.isTraversable(tile)) return null;

      tiles.push(tile);

      if (x === x1 && y === y1) break;

      const e2 = 2 * err;
      const shouldMoveX = e2 > -dy;
      const shouldMoveY = e2 < dx;

      if (shouldMoveX && shouldMoveY) {
        x += sx;
        err -= dy;

        const intermediateTile = (y * this.mapWidth + x) as TileRef;
        if (!this.isTraversable(intermediateTile)) {
          x -= sx;
          err += dy;
          y += sy;
          err += dx;

          const altTile = (y * this.mapWidth + x) as TileRef;
          if (!this.isTraversable(altTile)) return null;
          tiles.push(altTile);

          x += sx;
          err -= dy;
        } else {
          tiles.push(intermediateTile);
          y += sy;
          err += dx;
        }
      } else {
        if (shouldMoveX) {
          x += sx;
          err -= dy;
        }
        if (shouldMoveY) {
          y += sy;
          err += dx;
        }
      }
    }

    return tiles;
  }

  private manhattanDist(a: TileRef, b: TileRef): number {
    const ax = a % this.mapWidth;
    const ay = (a / this.mapWidth) | 0;
    const bx = b % this.mapWidth;
    const by = (b / this.mapWidth) | 0;
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }
}
