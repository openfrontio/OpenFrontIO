import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";
import { BucketQueue } from "./PriorityQueue";

const LAND_BIT = 7;

export interface BoundedAStarConfig {
  heuristicWeight?: number;
  maxIterations?: number;
}

export interface SearchBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class AStarBounded implements PathFinder<number> {
  private stamp = 1;

  private readonly closedStamp: Uint32Array;
  private readonly gScoreStamp: Uint32Array;
  private readonly gScore: Uint32Array;
  private readonly cameFrom: Int32Array;
  private readonly queue: BucketQueue;
  private readonly terrain: Uint8Array;
  private readonly mapWidth: number;
  private readonly heuristicWeight: number;
  private readonly maxIterations: number;

  constructor(
    map: GameMap,
    maxSearchArea: number,
    config?: BoundedAStarConfig,
  ) {
    this.terrain = (map as any).terrain as Uint8Array;
    this.mapWidth = map.width();
    this.heuristicWeight = config?.heuristicWeight ?? 1;
    this.maxIterations = config?.maxIterations ?? 100_000;

    this.closedStamp = new Uint32Array(maxSearchArea);
    this.gScoreStamp = new Uint32Array(maxSearchArea);
    this.gScore = new Uint32Array(maxSearchArea);
    this.cameFrom = new Int32Array(maxSearchArea);

    const maxDim = Math.ceil(Math.sqrt(maxSearchArea));
    const maxF = this.heuristicWeight * maxDim * 2;
    this.queue = new BucketQueue(maxF);
  }

  findPath(start: number | number[], goal: number): number[] | null {
    const starts = Array.isArray(start) ? start : [start];
    const goalX = goal % this.mapWidth;
    const goalY = (goal / this.mapWidth) | 0;

    let minX = goalX;
    let maxX = goalX;
    let minY = goalY;
    let maxY = goalY;

    for (const s of starts) {
      const sx = s % this.mapWidth;
      const sy = (s / this.mapWidth) | 0;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }

    return this.searchBounded(starts as TileRef[], goal as TileRef, {
      minX,
      maxX,
      minY,
      maxY,
    });
  }

  searchBounded(
    start: TileRef | TileRef[],
    goal: TileRef,
    bounds: SearchBounds,
  ): TileRef[] | null {
    this.stamp++;
    if (this.stamp > 0xffffffff) {
      this.closedStamp.fill(0);
      this.gScoreStamp.fill(0);
      this.stamp = 1;
    }

    const stamp = this.stamp;
    const mapWidth = this.mapWidth;
    const terrain = this.terrain;
    const closedStamp = this.closedStamp;
    const gScoreStamp = this.gScoreStamp;
    const gScore = this.gScore;
    const cameFrom = this.cameFrom;
    const queue = this.queue;
    const weight = this.heuristicWeight;
    const landMask = 1 << LAND_BIT;

    const { minX, maxX, minY, maxY } = bounds;
    const boundsWidth = maxX - minX + 1;
    const goalX = goal % mapWidth;
    const goalY = (goal / mapWidth) | 0;
    const boundsHeight = maxY - minY + 1;
    const numLocalNodes = boundsWidth * boundsHeight;

    if (numLocalNodes > this.closedStamp.length) {
      return null;
    }

    const toLocal = (tile: TileRef, clamp: boolean = false): number => {
      let x = tile % mapWidth;
      let y = (tile / mapWidth) | 0;
      if (clamp) {
        x = Math.max(minX, Math.min(maxX, x));
        y = Math.max(minY, Math.min(maxY, y));
      }
      return (y - minY) * boundsWidth + (x - minX);
    };

    const toGlobal = (local: number): TileRef => {
      const localX = local % boundsWidth;
      const localY = (local / boundsWidth) | 0;
      return ((localY + minY) * mapWidth + (localX + minX)) as TileRef;
    };

    const goalLocal = toLocal(goal, true);
    if (goalLocal < 0 || goalLocal >= numLocalNodes) {
      return null;
    }

    queue.clear();
    const starts = Array.isArray(start) ? start : [start];
    for (const s of starts) {
      const startLocal = toLocal(s, true);
      if (startLocal < 0 || startLocal >= numLocalNodes) {
        continue;
      }
      gScore[startLocal] = 0;
      gScoreStamp[startLocal] = stamp;
      cameFrom[startLocal] = -1;
      const sx = s % mapWidth;
      const sy = (s / mapWidth) | 0;
      const h = weight * (Math.abs(sx - goalX) + Math.abs(sy - goalY));
      queue.push(startLocal, h);
    }

    let iterations = this.maxIterations;

    while (!queue.isEmpty()) {
      if (--iterations <= 0) {
        return null;
      }

      const currentLocal = queue.pop();

      if (closedStamp[currentLocal] === stamp) continue;
      closedStamp[currentLocal] = stamp;

      if (currentLocal === goalLocal) {
        return this.buildPath(goalLocal, toGlobal, numLocalNodes);
      }

      const currentG = gScore[currentLocal];
      const tentativeG = currentG + 1;

      // Convert to global coords for neighbor calculation
      const current = toGlobal(currentLocal);
      const currentX = current % mapWidth;
      const currentY = (current / mapWidth) | 0;

      if (currentY > minY) {
        const neighbor = current - mapWidth;
        const neighborLocal = currentLocal - boundsWidth;
        if (
          closedStamp[neighborLocal] !== stamp &&
          (neighbor === goal || (terrain[neighbor] & landMask) === 0)
        ) {
          if (
            gScoreStamp[neighborLocal] !== stamp ||
            tentativeG < gScore[neighborLocal]
          ) {
            cameFrom[neighborLocal] = currentLocal;
            gScore[neighborLocal] = tentativeG;
            gScoreStamp[neighborLocal] = stamp;
            const f =
              tentativeG +
              weight *
                (Math.abs(currentX - goalX) + Math.abs(currentY - 1 - goalY));
            queue.push(neighborLocal, f);
          }
        }
      }

      if (currentY < maxY) {
        const neighbor = current + mapWidth;
        const neighborLocal = currentLocal + boundsWidth;
        if (
          closedStamp[neighborLocal] !== stamp &&
          (neighbor === goal || (terrain[neighbor] & landMask) === 0)
        ) {
          if (
            gScoreStamp[neighborLocal] !== stamp ||
            tentativeG < gScore[neighborLocal]
          ) {
            cameFrom[neighborLocal] = currentLocal;
            gScore[neighborLocal] = tentativeG;
            gScoreStamp[neighborLocal] = stamp;
            const f =
              tentativeG +
              weight *
                (Math.abs(currentX - goalX) + Math.abs(currentY + 1 - goalY));
            queue.push(neighborLocal, f);
          }
        }
      }

      if (currentX > minX) {
        const neighbor = current - 1;
        const neighborLocal = currentLocal - 1;
        if (
          closedStamp[neighborLocal] !== stamp &&
          (neighbor === goal || (terrain[neighbor] & landMask) === 0)
        ) {
          if (
            gScoreStamp[neighborLocal] !== stamp ||
            tentativeG < gScore[neighborLocal]
          ) {
            cameFrom[neighborLocal] = currentLocal;
            gScore[neighborLocal] = tentativeG;
            gScoreStamp[neighborLocal] = stamp;
            const f =
              tentativeG +
              weight *
                (Math.abs(currentX - 1 - goalX) + Math.abs(currentY - goalY));
            queue.push(neighborLocal, f);
          }
        }
      }

      if (currentX < maxX) {
        const neighbor = current + 1;
        const neighborLocal = currentLocal + 1;
        if (
          closedStamp[neighborLocal] !== stamp &&
          (neighbor === goal || (terrain[neighbor] & landMask) === 0)
        ) {
          if (
            gScoreStamp[neighborLocal] !== stamp ||
            tentativeG < gScore[neighborLocal]
          ) {
            cameFrom[neighborLocal] = currentLocal;
            gScore[neighborLocal] = tentativeG;
            gScoreStamp[neighborLocal] = stamp;
            const f =
              tentativeG +
              weight *
                (Math.abs(currentX + 1 - goalX) + Math.abs(currentY - goalY));
            queue.push(neighborLocal, f);
          }
        }
      }
    }

    return null;
  }

  private buildPath(
    goalLocal: number,
    toGlobal: (local: number) => TileRef,
    maxPathLength: number,
  ): TileRef[] {
    const path: TileRef[] = [];
    let current = goalLocal;

    // Safety check to prevent infinite loops
    let iterations = 0;
    while (current !== -1 && iterations < maxPathLength) {
      path.push(toGlobal(current));
      current = this.cameFrom[current];
      iterations++;
    }

    path.reverse();
    return path;
  }
}
