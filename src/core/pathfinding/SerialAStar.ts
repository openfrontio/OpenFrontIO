import { PriorityQueue } from "@datastructures-js/priority-queue";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";

export class SerialAStar implements AStar {
  private fwdOpenSet: PriorityQueue<{
    tile: TileRef;
    fScore: number;
  }>;

  private bwdOpenSet: PriorityQueue<{
    tile: TileRef;
    fScore: number;
  }>;

  private fwdCameFrom: Map<TileRef, TileRef>;
  private bwdCameFrom: Map<TileRef, TileRef>;
  private fwdGScore: Map<TileRef, number>;
  private bwdGScore: Map<TileRef, number>;
  private meetingPoint: TileRef | null;
  public completed: boolean;
  private sources: TileRef[];
  private closestSource: TileRef;

  constructor(
    src: TileRef | TileRef[],
    private dst: TileRef,
    private iterations: number,
    private maxTries: number,
    private gameMap: GameMap,
  ) {
    this.fwdOpenSet = new PriorityQueue<{
      tile: TileRef;
      fScore: number;
    }>((a, b) => a.fScore - b.fScore);

    this.bwdOpenSet = new PriorityQueue<{
      tile: TileRef;
      fScore: number;
    }>((a, b) => a.fScore - b.fScore);

    this.fwdCameFrom = new Map<TileRef, TileRef>();
    this.bwdCameFrom = new Map<TileRef, TileRef>();
    this.fwdGScore = new Map<TileRef, number>();
    this.bwdGScore = new Map<TileRef, number>();
    this.meetingPoint = null;
    this.completed = false;

    this.sources = Array.isArray(src) ? src : [src];
    this.closestSource = this.findClosestSource(dst);

    // Initialize forward search with source point(s)
    this.sources.forEach((startPoint) => {
      this.fwdGScore.set(startPoint, 0);
      this.fwdOpenSet.enqueue({
        tile: startPoint,
        fScore: this.heuristic(startPoint, dst),
      });
    });

    // Initialize backward search from destination
    this.bwdGScore.set(dst, 0);
    this.bwdOpenSet.enqueue({
      tile: dst,
      fScore: this.heuristic(dst, this.findClosestSource(dst)),
    });
  }

  private findClosestSource(tile: TileRef): TileRef {
    return this.sources.reduce((closest, source) =>
      this.heuristic(tile, source) < this.heuristic(tile, closest)
        ? source
        : closest,
    );
  }

  compute(): PathFindResultType {
    if (this.completed) return PathFindResultType.Completed;

    this.maxTries -= 1;
    let iterations = this.iterations;

    while (!this.fwdOpenSet.isEmpty() && !this.bwdOpenSet.isEmpty()) {
      iterations--;
      if (iterations <= 0) {
        if (this.maxTries <= 0) {
          return PathFindResultType.PathNotFound;
        }
        return PathFindResultType.Pending;
      }

      // Process forward search
      const fwdCurrent = this.fwdOpenSet.dequeue()!.tile;

      // Check if we've found a meeting point
      if (this.bwdGScore.has(fwdCurrent)) {
        this.meetingPoint = fwdCurrent;
        this.completed = true;
        return PathFindResultType.Completed;
      }

      this.expandTileRef(fwdCurrent, true);

      // Process backward search
      const bwdCurrent = this.bwdOpenSet.dequeue()!.tile;

      // Check if we've found a meeting point
      if (this.fwdGScore.has(bwdCurrent)) {
        this.meetingPoint = bwdCurrent;
        this.completed = true;
        return PathFindResultType.Completed;
      }

      this.expandTileRef(bwdCurrent, false);
    }

    return this.completed
      ? PathFindResultType.Completed
      : PathFindResultType.PathNotFound;
  }

  /**
   * Expands the current tile by exploring its neighbors and updating scores
   * and paths for the A* algorithm. This method supports both forward and backward
   * search depending on the `isForward` flag.
   *
   * @param current - The current TileRef being expanded.
   * @param isForward - Boolean indicating whether this is the forward search (true)
   *                    or backward search (false).
   */
  private expandTileRef(current: TileRef, isForward: boolean) {
    for (const neighbor of this.gameMap.neighbors(current)) {
      if (
        neighbor !== (isForward ? this.dst : this.closestSource) &&
        !this.gameMap.isWater(neighbor)
      )
        continue;

      const gScore = isForward ? this.fwdGScore : this.bwdGScore;
      const openSet = isForward ? this.fwdOpenSet : this.bwdOpenSet;
      const cameFrom = isForward ? this.fwdCameFrom : this.bwdCameFrom;

      const tentativeGScore =
        gScore.get(current)! + this.gameMap.cost(neighbor);

      if (!gScore.has(neighbor) || tentativeGScore < gScore.get(neighbor)!) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeGScore);
        const fScore =
          tentativeGScore +
          this.heuristic(neighbor, isForward ? this.dst : this.closestSource);
        openSet.enqueue({ tile: neighbor, fScore: fScore });
      }
    }
  }

  /**
   * Estimates the cost (heuristic) between two tiles using Manhattan distance,
   * scaled by a factor of 1.1 to slightly overestimate the distance.
   *
   * @param a - The starting TileRef.
   * @param b - The destination TileRef.
   * @returns The heuristic cost estimate between tile a and b.
   */
  private heuristic(a: TileRef, b: TileRef): number {
    try {
      const dx = Math.abs(this.gameMap.x(a) - this.gameMap.x(b));
      const dy = Math.abs(this.gameMap.y(a) - this.gameMap.y(b));
      return 1.1 * (dx + dy);
    } catch {
      // In case of an error (e.g., invalid tile refs), return 0 as fallback
      return 0;
    }
  }

  /**
   * Reconstructs the full path from the start to the goal by combining
   * the forward path (start to meeting point) and backward path (meeting point to goal).
   *
   * @returns An array of TileRefs representing the complete path.
   *          Returns an empty array if no meeting point is set.
   */
  public reconstructPath(): TileRef[] {
    if (!this.meetingPoint) return [];

    // Path from start to meeting point (forward direction)
    const path: TileRef[] = [this.meetingPoint];
    let current = this.meetingPoint;

    // Walk backward through the forward cameFrom map to reconstruct the path start -> meeting point
    while (this.fwdCameFrom.has(current)) {
      current = this.fwdCameFrom.get(current)!;
      path.unshift(current);
    }

    // Walk forward through the backward cameFrom map to reconstruct the path meeting point -> goal
    current = this.meetingPoint;
    while (this.bwdCameFrom.has(current)) {
      current = this.bwdCameFrom.get(current)!;
      path.push(current);
    }

    return path;
  }
}
