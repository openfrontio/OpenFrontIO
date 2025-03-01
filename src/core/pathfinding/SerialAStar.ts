import { PriorityQueue } from "@datastructures-js/priority-queue";
import { consolex } from "../Consolex";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";

export class SerialAStar implements AStar {
  private fwdOpenSet: PriorityQueue<{ tile: TileRef; fScore: number }>;
  private bwdOpenSet: PriorityQueue<{ tile: TileRef; fScore: number }>;
  private fwdCameFrom: Map<TileRef, TileRef>;
  private bwdCameFrom: Map<TileRef, TileRef>;
  private fwdGScore: Map<TileRef, number>;
  private bwdGScore: Map<TileRef, number>;
  private meetingPoint: TileRef | null;
  public completed: boolean;

  constructor(
    private src: TileRef,
    private dst: TileRef,
    private canMove: (t: TileRef) => boolean,
    private iterations: number,
    private maxTries: number,
    private gameMap: GameMap,
  ) {
    this.fwdOpenSet = new PriorityQueue<{ tile: TileRef; fScore: number }>(
      (a, b) => a.fScore - b.fScore,
    );
    this.bwdOpenSet = new PriorityQueue<{ tile: TileRef; fScore: number }>(
      (a, b) => a.fScore - b.fScore,
    );
    this.fwdCameFrom = new Map<TileRef, TileRef>();
    this.bwdCameFrom = new Map<TileRef, TileRef>();
    this.fwdGScore = new Map<TileRef, number>();
    this.bwdGScore = new Map<TileRef, number>();
    this.meetingPoint = null;
    this.completed = false;

    // Initialize forward search
    this.fwdGScore.set(src, 0);
    this.fwdOpenSet.enqueue({ tile: src, fScore: this.heuristic(src, dst) });

    // Initialize backward search
    this.bwdGScore.set(dst, 0);
    this.bwdOpenSet.enqueue({ tile: dst, fScore: this.heuristic(dst, src) });
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
      if (this.bwdGScore.has(fwdCurrent)) {
        // We found a meeting point!
        this.meetingPoint = fwdCurrent;
        this.completed = true;
        return PathFindResultType.Completed;
      }

      this.expandTileRef(fwdCurrent, true);

      // Process backward search
      const bwdCurrent = this.bwdOpenSet.dequeue()!.tile;
      if (this.fwdGScore.has(bwdCurrent)) {
        // We found a meeting point!
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
        neighbor != (isForward ? this.dst : this.src) &&
        !this.canMove(neighbor)
      )
        continue;

      const gScore = isForward ? this.fwdGScore : this.bwdGScore;
      const openSet = isForward ? this.fwdOpenSet : this.bwdOpenSet;
      const cameFrom = isForward ? this.fwdCameFrom : this.bwdCameFrom;

      let tentativeGScore = gScore.get(current)! + this.gameMap.cost(neighbor);

      if (!gScore.has(neighbor) || tentativeGScore < gScore.get(neighbor)!) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeGScore);
        const fScore =
          tentativeGScore +
          this.heuristic(neighbor, isForward ? this.dst : this.src);
        openSet.enqueue({ tile: neighbor, fScore: fScore });
      }
    }
  }

  private heuristic(a: TileRef, b: TileRef): number {
    // TODO use wrapped
    try {
      return (
        1.1 * Math.abs(this.gameMap.x(a) - this.gameMap.x(b)) +
        Math.abs(this.gameMap.y(a) - this.gameMap.y(b))
      );
    } catch {
      consolex.log("uh oh");
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
