import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";
import { MinHeap, PriorityQueue } from "./PriorityQueue";

const LAND_BIT = 7; // Bit 7 in terrain indicates land
const MAGNITUDE_MASK = 0x1f;
const COST_SCALE = 100;
const BASE_COST = 1 * COST_SCALE;

// Prefer magnitude 3-10 (3-10 tiles from shore)
function getMagnitudePenalty(magnitude: number): number {
  if (magnitude < 3) return 10 * COST_SCALE; // too close to shore
  if (magnitude <= 10) return 0; // sweet spot
  return 1 * COST_SCALE; // deep water, slight penalty
}

export interface AStarWaterConfig {
  heuristicWeight?: number;
  maxIterations?: number;
}

export class AStarWater implements PathFinder<number> {
  private stamp = 1;

  private readonly closedStamp: Uint32Array;
  private readonly gScoreStamp: Uint32Array;
  private readonly gScore: Uint32Array;
  private readonly cameFrom: Int32Array;
  private readonly queue: PriorityQueue;
  private readonly terrain: Uint8Array;
  private readonly width: number;
  private readonly numNodes: number;
  private readonly heuristicWeight: number;
  private readonly maxIterations: number;

  constructor(map: GameMap, config?: AStarWaterConfig) {
    this.terrain = (map as any).terrain as Uint8Array;
    this.width = map.width();
    this.numNodes = map.width() * map.height();
    this.heuristicWeight = config?.heuristicWeight ?? 5;
    this.maxIterations = config?.maxIterations ?? 1_000_000;

    this.closedStamp = new Uint32Array(this.numNodes);
    this.gScoreStamp = new Uint32Array(this.numNodes);
    this.gScore = new Uint32Array(this.numNodes);
    this.cameFrom = new Int32Array(this.numNodes);

    this.queue = new MinHeap(this.numNodes);
  }

  findPath(start: number | number[], goal: number): number[] | null {
    this.stamp++;
    if (this.stamp > 0xffffffff) {
      this.closedStamp.fill(0);
      this.gScoreStamp.fill(0);
      this.stamp = 1;
    }

    const stamp = this.stamp;
    const width = this.width;
    const numNodes = this.numNodes;
    const terrain = this.terrain;
    const closedStamp = this.closedStamp;
    const gScoreStamp = this.gScoreStamp;
    const gScore = this.gScore;
    const cameFrom = this.cameFrom;
    const queue = this.queue;
    const weight = this.heuristicWeight;
    const landMask = 1 << LAND_BIT;

    const goalX = goal % width;
    const goalY = (goal / width) | 0;

    queue.clear();
    const starts = Array.isArray(start) ? start : [start];

    // For cross-product tie-breaker (prefer diagonal paths)
    const s0 = starts[0];
    const startX = s0 % width;
    const startY = (s0 / width) | 0;
    const dxGoal = goalX - startX;
    const dyGoal = goalY - startY;
    // Normalization factor to keep tie-breaker small (< COST_SCALE)
    const crossNorm = Math.max(1, Math.abs(dxGoal) + Math.abs(dyGoal));

    // Cross-product tie-breaker: measures deviation from start-goal line
    const crossTieBreaker = (nx: number, ny: number): number => {
      const dxN = nx - goalX;
      const dyN = ny - goalY;
      const cross = Math.abs(dxGoal * dyN - dyGoal * dxN);
      return Math.floor((cross * (COST_SCALE - 1)) / crossNorm / crossNorm);
    };

    for (const s of starts) {
      gScore[s] = 0;
      gScoreStamp[s] = stamp;
      cameFrom[s] = -1;
      const sx = s % width;
      const sy = (s / width) | 0;
      const h =
        weight * BASE_COST * (Math.abs(sx - goalX) + Math.abs(sy - goalY));
      queue.push(s, h);
    }

    let iterations = this.maxIterations;

    while (!queue.isEmpty()) {
      if (--iterations <= 0) {
        return null;
      }

      const current = queue.pop();

      if (closedStamp[current] === stamp) continue;
      closedStamp[current] = stamp;

      if (current === goal) {
        return this.buildPath(goal);
      }

      const currentG = gScore[current];
      const currentX = current % width;
      const currentY = (current / width) | 0;

      if (current >= width) {
        const neighbor = current - width;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal || (neighborTerrain & landMask) === 0)
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const ny = currentY - 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(currentX - goalX) + Math.abs(ny - goalY));
            const f = tentativeG + h + crossTieBreaker(currentX, ny);
            queue.push(neighbor, f);
          }
        }
      }

      if (current < numNodes - width) {
        const neighbor = current + width;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal || (neighborTerrain & landMask) === 0)
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const ny = currentY + 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(currentX - goalX) + Math.abs(ny - goalY));
            const f = tentativeG + h + crossTieBreaker(currentX, ny);
            queue.push(neighbor, f);
          }
        }
      }

      if (currentX !== 0) {
        const neighbor = current - 1;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal || (neighborTerrain & landMask) === 0)
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const nx = currentX - 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(nx - goalX) + Math.abs(currentY - goalY));
            const f = tentativeG + h + crossTieBreaker(nx, currentY);
            queue.push(neighbor, f);
          }
        }
      }

      if (currentX !== width - 1) {
        const neighbor = current + 1;
        const neighborTerrain = terrain[neighbor];
        if (
          closedStamp[neighbor] !== stamp &&
          (neighbor === goal || (neighborTerrain & landMask) === 0)
        ) {
          const magnitude = neighborTerrain & MAGNITUDE_MASK;
          const cost = BASE_COST + getMagnitudePenalty(magnitude);
          const tentativeG = currentG + cost;
          if (
            gScoreStamp[neighbor] !== stamp ||
            tentativeG < gScore[neighbor]
          ) {
            cameFrom[neighbor] = current;
            gScore[neighbor] = tentativeG;
            gScoreStamp[neighbor] = stamp;
            const nx = currentX + 1;
            const h =
              weight *
              BASE_COST *
              (Math.abs(nx - goalX) + Math.abs(currentY - goalY));
            const f = tentativeG + h + crossTieBreaker(nx, currentY);
            queue.push(neighbor, f);
          }
        }
      }
    }

    return null;
  }

  private buildPath(goal: number): TileRef[] {
    const path: TileRef[] = [];
    let current = goal;

    while (current !== -1) {
      path.push(current as TileRef);
      current = this.cameFrom[current];
    }

    path.reverse();
    return path;
  }
}
