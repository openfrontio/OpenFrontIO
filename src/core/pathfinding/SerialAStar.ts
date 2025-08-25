import FastPriorityQueue from "fastpriorityqueue";
import { AStar, PathFindResultType } from "./AStar";

/**
 * Implement this interface with your graph to find paths with A*
 */
export type GraphAdapter<NodeType> = {
  neighbors(node: NodeType): NodeType[];
  cost(node: NodeType): number;
  position(node: NodeType): { x: number; y: number };
  isTraversable(from: NodeType, to: NodeType): boolean;
};

export class SerialAStar<NodeType> implements AStar<NodeType> {
  private readonly fwdOpenSet: FastPriorityQueue<{
    tile: NodeType;
    fScore: number;
  }>;
  private readonly bwdOpenSet: FastPriorityQueue<{
    tile: NodeType;
    fScore: number;
  }>;

  private readonly fwdCameFrom = new Map<NodeType, NodeType>();
  private readonly bwdCameFrom = new Map<NodeType, NodeType>();
  private readonly fwdGScore = new Map<NodeType, number>();
  private readonly bwdGScore = new Map<NodeType, number>();

  private meetingPoint: NodeType | null = null;
  public completed = false;
  private readonly sources: NodeType[];
  private readonly closestSource: NodeType;

  constructor(
    src: NodeType | NodeType[],
    private readonly dst: NodeType,
    private readonly iterations: number,
    private maxTries: number,
    private readonly graph: GraphAdapter<NodeType>,
    private readonly directionChangePenalty = 0,
  ) {
    this.fwdOpenSet = new FastPriorityQueue((a, b) => a.fScore < b.fScore);
    this.bwdOpenSet = new FastPriorityQueue((a, b) => a.fScore < b.fScore);
    this.sources = Array.isArray(src) ? src : [src];
    this.closestSource = this.findClosestSource(dst);

    // Initialize forward search with source point(s)
    this.sources.forEach((startPoint) => {
      this.fwdGScore.set(startPoint, 0);
      this.fwdOpenSet.add({
        fScore: this.heuristic(startPoint, dst),
        tile: startPoint,
      });
    });

    // Initialize backward search from destination
    this.bwdGScore.set(dst, 0);
    this.bwdOpenSet.add({
      fScore: this.heuristic(dst, this.findClosestSource(dst)),
      tile: dst,
    });
  }

  private findClosestSource(tile: NodeType): NodeType {
    return this.sources.reduce((closest, source) =>
      this.heuristic(tile, source) < this.heuristic(tile, closest)
        ? source
        : closest,
    );
  }

  compute(): PathFindResultType {
    if (this.completed) return PathFindResultType.Completed;

    this.maxTries -= 1;
    let { iterations } = this;

    while (!this.fwdOpenSet.isEmpty() && !this.bwdOpenSet.isEmpty()) {
      iterations--;
      if (iterations <= 0) {
        if (this.maxTries <= 0) {
          return PathFindResultType.PathNotFound;
        }
        return PathFindResultType.Pending;
      }

      // Process forward search
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const fwdCurrent = this.fwdOpenSet.poll()!.tile;

      // Check if we've found a meeting point
      if (this.bwdGScore.has(fwdCurrent)) {
        this.meetingPoint = fwdCurrent;
        this.completed = true;
        return PathFindResultType.Completed;
      }
      this.expandNode(fwdCurrent, true);

      // Process backward search
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const bwdCurrent = this.bwdOpenSet.poll()!.tile;

      // Check if we've found a meeting point
      if (this.fwdGScore.has(bwdCurrent)) {
        this.meetingPoint = bwdCurrent;
        this.completed = true;
        return PathFindResultType.Completed;
      }
      this.expandNode(bwdCurrent, false);
    }

    return this.completed
      ? PathFindResultType.Completed
      : PathFindResultType.PathNotFound;
  }

  private expandNode(current: NodeType, isForward: boolean) {
    for (const neighbor of this.graph.neighbors(current)) {
      if (
        neighbor !== (isForward ? this.dst : this.closestSource) &&
        !this.graph.isTraversable(current, neighbor)
      )
        continue;

      const gScore = isForward ? this.fwdGScore : this.bwdGScore;
      const openSet = isForward ? this.fwdOpenSet : this.bwdOpenSet;
      const cameFrom = isForward ? this.fwdCameFrom : this.bwdCameFrom;

      const tentativeGScore =
        (gScore.get(current) ?? 0) + this.graph.cost(neighbor);
      let penalty = 0;
      // With a direction change penalty, the path will get as straight as possible
      if (this.directionChangePenalty > 0) {
        const prev = cameFrom.get(current);
        if (prev) {
          const prevDir = this.getDirection(prev, current);
          const newDir = this.getDirection(current, neighbor);
          if (prevDir !== newDir) {
            penalty = this.directionChangePenalty;
          }
        }
      }

      const totalG = tentativeGScore + penalty;
      const g = gScore.get(neighbor);
      if (g === undefined || totalG < g) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, totalG);
        const fScore =
          totalG +
          this.heuristic(neighbor, isForward ? this.dst : this.closestSource);

        openSet.add({ fScore, tile: neighbor });
      }
    }
  }

  private heuristic(a: NodeType, b: NodeType): number {
    const posA = this.graph.position(a);
    const posB = this.graph.position(b);
    return 2 * (Math.abs(posA.x - posB.x) + Math.abs(posA.y - posB.y));
  }

  private getDirection(from: NodeType, to: NodeType): string {
    const fromPos = this.graph.position(from);
    const toPos = this.graph.position(to);
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    return `${Math.sign(dx)},${Math.sign(dy)}`;
  }

  public reconstructPath(): NodeType[] {
    if (!this.meetingPoint) return [];

    // Reconstruct path from start to meeting point
    const fwdPath: NodeType[] = [this.meetingPoint];
    let current: NodeType = this.meetingPoint;

    let f = this.fwdCameFrom.get(current);
    while (f !== undefined) {
      current = f;
      fwdPath.unshift(current);
      f = this.fwdCameFrom.get(current);
    }

    // Reconstruct path from meeting point to goal
    current = this.meetingPoint;

    let b = this.bwdCameFrom.get(current);
    while (b !== undefined) {
      current = b;
      fwdPath.push(current);
      b = this.bwdCameFrom.get(current);
    }

    return fwdPath;
  }
}
