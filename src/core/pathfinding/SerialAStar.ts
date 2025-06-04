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

  private heuristic(a: TileRef, b: TileRef): number {
    try {
      return (
        1.1 *
        (Math.abs(this.gameMap.x(a) - this.gameMap.x(b)) +
          Math.abs(this.gameMap.y(a) - this.gameMap.y(b)))
      );
    } catch {
      console.log("uh oh");
      return 0;
    }
  }

  public reconstructPath(): TileRef[] {
    if (!this.meetingPoint) return [];

    // Reconstruct path from start to meeting point
    const fwdPath: TileRef[] = [this.meetingPoint];
    let current = this.meetingPoint;

    while (this.fwdCameFrom.has(current)) {
      current = this.fwdCameFrom.get(current)!;
      fwdPath.unshift(current);
    }

    // Reconstruct path from meeting point to goal
    current = this.meetingPoint;

    while (this.bwdCameFrom.has(current)) {
      current = this.bwdCameFrom.get(current)!;
      fwdPath.push(current);
    }

    return fwdPath;
  }
}
