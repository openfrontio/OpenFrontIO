// Generic A* implementation with adapter interface
// See AStar.Rail.ts for adapter version where performance is not critical
// See AStar.Water.ts for inlined version for performance-critical use

import { PathFinder } from "../types";
import { BucketQueue, PriorityQueue } from "./PriorityQueue";

export interface AStarAdapter {
  // Important optimization: write to the buffer and return the count
  // You can do this and it will be much faster :)
  neighbors(node: number, buffer: Int32Array): number;

  cost(from: number, to: number, prev?: number): number;
  heuristic(node: number, goal: number): number;
  numNodes(): number;
  maxPriority(): number;
  maxNeighbors(): number;
}

export interface AStarConfig {
  adapter: AStarAdapter;
  maxIterations?: number;
}

export class AStar implements PathFinder<number> {
  private stamp = 1;

  private readonly closedStamp: Uint32Array;
  private readonly gScoreStamp: Uint32Array;
  private readonly gScore: Uint32Array;
  private readonly cameFrom: Int32Array;
  private readonly queue: PriorityQueue;
  private readonly adapter: AStarAdapter;
  private readonly neighborBuffer: Int32Array;
  private readonly maxIterations: number;

  constructor(config: AStarConfig) {
    this.adapter = config.adapter;
    this.maxIterations = config.maxIterations ?? 500_000;
    this.neighborBuffer = new Int32Array(this.adapter.maxNeighbors());
    this.closedStamp = new Uint32Array(this.adapter.numNodes());
    this.gScoreStamp = new Uint32Array(this.adapter.numNodes());
    this.gScore = new Uint32Array(this.adapter.numNodes());
    this.cameFrom = new Int32Array(this.adapter.numNodes());
    this.queue = new BucketQueue(this.adapter.maxPriority());
  }

  findPath(start: number | number[], goal: number): number[] | null {
    this.stamp++;
    if (this.stamp > 0xffffffff) {
      this.closedStamp.fill(0);
      this.gScoreStamp.fill(0);
      this.stamp = 1;
    }

    const stamp = this.stamp;
    const adapter = this.adapter;
    const closedStamp = this.closedStamp;
    const gScoreStamp = this.gScoreStamp;
    const gScore = this.gScore;
    const cameFrom = this.cameFrom;
    const queue = this.queue;
    const buffer = this.neighborBuffer;

    queue.clear();
    const starts = Array.isArray(start) ? start : [start];
    for (const s of starts) {
      gScore[s] = 0;
      gScoreStamp[s] = stamp;
      cameFrom[s] = -1;
      queue.push(s, adapter.heuristic(s, goal));
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
      const prev = cameFrom[current];
      const count = adapter.neighbors(current, buffer);

      for (let i = 0; i < count; i++) {
        const neighbor = buffer[i];

        if (closedStamp[neighbor] === stamp) continue;

        const tentativeG =
          currentG +
          adapter.cost(current, neighbor, prev === -1 ? undefined : prev);

        if (gScoreStamp[neighbor] !== stamp || tentativeG < gScore[neighbor]) {
          cameFrom[neighbor] = current;
          gScore[neighbor] = tentativeG;
          gScoreStamp[neighbor] = stamp;
          queue.push(neighbor, tentativeG + adapter.heuristic(neighbor, goal));
        }
      }
    }

    return null;
  }

  private buildPath(goal: number): number[] {
    const path: number[] = [];
    let current = goal;

    while (current !== -1) {
      path.push(current);
      current = this.cameFrom[current];
    }

    path.reverse();
    return path;
  }
}
