import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";
import { PathSmoother } from "./PathSmoother";

/**
 * Path smoother using Bresenham line-of-sight algorithm.
 * Greedily skips waypoints when direct traversal is possible.
 */
export class BresenhamPathSmoother implements PathSmoother<TileRef> {
  constructor(
    private map: GameMap,
    private isTraversable: (tile: TileRef) => boolean,
  ) {}

  smooth(path: TileRef[]): TileRef[] {
    if (path.length <= 2) {
      return path;
    }

    const smoothed: TileRef[] = [];
    let current = 0;

    while (current < path.length - 1) {
      let farthest = current + 1;
      let bestTrace: TileRef[] | null = null;

      for (
        let i = current + 2;
        i < path.length;
        i += Math.max(1, Math.floor(path.length / 20))
      ) {
        const trace = this.tracePath(path[current], path[i]);

        if (trace !== null) {
          farthest = i;
          bestTrace = trace;
        } else {
          break;
        }
      }

      if (
        farthest < path.length - 1 &&
        (path.length - 1 - current) % 10 !== 0
      ) {
        const trace = this.tracePath(path[current], path[path.length - 1]);
        if (trace !== null) {
          farthest = path.length - 1;
          bestTrace = trace;
        }
      }

      if (bestTrace !== null && farthest > current + 1) {
        smoothed.push(...bestTrace.slice(0, -1));
      } else {
        smoothed.push(path[current]);
      }

      current = farthest;
    }

    smoothed.push(path[path.length - 1]);

    return smoothed;
  }

  private tracePath(from: TileRef, to: TileRef): TileRef[] | null {
    const x0 = this.map.x(from);
    const y0 = this.map.y(from);
    const x1 = this.map.x(to);
    const y1 = this.map.y(to);

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
      if (iterations++ > maxTiles) {
        return null;
      }
      const tile = this.map.ref(x, y);
      if (!this.isTraversable(tile)) {
        return null;
      }

      tiles.push(tile);

      if (x === x1 && y === y1) {
        break;
      }

      const e2 = 2 * err;
      const shouldMoveX = e2 > -dy;
      const shouldMoveY = e2 < dx;

      if (shouldMoveX && shouldMoveY) {
        x += sx;
        err -= dy;

        const intermediateTile = this.map.ref(x, y);
        if (!this.isTraversable(intermediateTile)) {
          x -= sx;
          err += dy;

          y += sy;
          err += dx;

          const altTile = this.map.ref(x, y);
          if (!this.isTraversable(altTile)) {
            return null;
          }
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
}

/**
 * Ready-to-use transformer that applies Bresenham smoothing.
 * Defaults to water traversability.
 */
export class BresenhamSmoothingTransformer implements PathFinder<TileRef> {
  private smoother: BresenhamPathSmoother;

  constructor(
    private inner: PathFinder<TileRef>,
    map: GameMap,
    isTraversable: (tile: TileRef) => boolean = (t) => map.isWater(t),
  ) {
    this.smoother = new BresenhamPathSmoother(map, isTraversable);
  }

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    const path = this.inner.findPath(from, to);
    return path ? this.smoother.smooth(path) : null;
  }
}
