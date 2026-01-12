import { PathFinder } from "../types";
import { AbstractGraph } from "./AbstractGraph";
import { BucketQueue, MinHeap, PriorityQueue } from "./PriorityQueue";

export interface AbstractGraphAStarConfig {
  heuristicWeight?: number;
  maxIterations?: number;
  useMinHeap?: boolean; // Use MinHeap instead of BucketQueue (better for variable costs)
}

export class AbstractGraphAStar implements PathFinder<number> {
  private stamp = 1;

  private readonly closedStamp: Uint32Array;
  private readonly gScoreStamp: Uint32Array;
  private readonly gScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly startNode: Int32Array; // tracks which start each node came from
  private readonly queue: PriorityQueue;
  private readonly graph: AbstractGraph;
  private readonly heuristicWeight: number;
  private readonly maxIterations: number;

  constructor(graph: AbstractGraph, config?: AbstractGraphAStarConfig) {
    this.graph = graph;
    this.heuristicWeight = config?.heuristicWeight ?? 1;
    this.maxIterations = config?.maxIterations ?? 100_000;

    const numNodes = graph.nodeCount;

    this.closedStamp = new Uint32Array(numNodes);
    this.gScoreStamp = new Uint32Array(numNodes);
    this.gScore = new Float32Array(numNodes);
    this.cameFrom = new Int32Array(numNodes);
    this.startNode = new Int32Array(numNodes);

    // For abstract graphs with variable costs, MinHeap may be better
    // BucketQueue is O(1) but requires integer priorities
    if (config?.useMinHeap) {
      this.queue = new MinHeap(numNodes);
    } else {
      // Estimate max priority: weight * (mapWidth + mapHeight)
      // Use cluster size * clusters as approximation
      const maxDist = graph.clusterSize * Math.max(graph.clustersX, 10) * 2;
      const maxF = this.heuristicWeight * maxDist;
      this.queue = new BucketQueue(maxF);
    }
  }

  findPath(start: number | number[], goal: number): number[] | null {
    if (Array.isArray(start)) {
      return this.findPathMultiSource(start, goal);
    }
    return this.findPathSingle(start, goal);
  }

  private findPathSingle(startId: number, goalId: number): number[] | null {
    this.stamp++;
    if (this.stamp > 0xffffffff) {
      this.closedStamp.fill(0);
      this.gScoreStamp.fill(0);
      this.stamp = 1;
    }

    const stamp = this.stamp;
    const graph = this.graph;
    const closedStamp = this.closedStamp;
    const gScoreStamp = this.gScoreStamp;
    const gScore = this.gScore;
    const cameFrom = this.cameFrom;
    const queue = this.queue;
    const weight = this.heuristicWeight;

    // Get goal node for heuristic
    const goalNode = graph.getNode(goalId);
    if (!goalNode) return null;
    const goalX = goalNode.x;
    const goalY = goalNode.y;

    // Get start node for initial heuristic
    const startNode = graph.getNode(startId);
    if (!startNode) return null;

    // Initialize
    queue.clear();
    gScore[startId] = 0;
    gScoreStamp[startId] = stamp;
    cameFrom[startId] = -1;

    const startH =
      weight * (Math.abs(startNode.x - goalX) + Math.abs(startNode.y - goalY));
    queue.push(startId, startH);

    let iterations = this.maxIterations;

    while (!queue.isEmpty()) {
      if (--iterations <= 0) {
        return null;
      }

      const current = queue.pop();

      if (closedStamp[current] === stamp) continue;
      closedStamp[current] = stamp;

      if (current === goalId) {
        return this.buildPathFromGoal(goalId);
      }

      const currentG = gScore[current];
      const edges = graph.getNodeEdges(current);

      // Inline neighbor iteration
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const neighbor = graph.getOtherNode(edge, current);

        if (closedStamp[neighbor] === stamp) continue;

        const tentativeG = currentG + edge.cost;

        if (gScoreStamp[neighbor] !== stamp || tentativeG < gScore[neighbor]) {
          cameFrom[neighbor] = current;
          gScore[neighbor] = tentativeG;
          gScoreStamp[neighbor] = stamp;

          // Inline heuristic calculation
          const neighborNode = graph.getNode(neighbor);
          if (neighborNode) {
            const h =
              weight *
              (Math.abs(neighborNode.x - goalX) +
                Math.abs(neighborNode.y - goalY));
            queue.push(neighbor, tentativeG + h);
          }
        }
      }
    }

    return null;
  }

  private findPathMultiSource(
    startIds: number[],
    goalId: number,
  ): number[] | null {
    if (startIds.length === 0) return null;
    if (startIds.length === 1) return this.findPathSingle(startIds[0], goalId);

    this.stamp++;
    if (this.stamp > 0xffffffff) {
      this.closedStamp.fill(0);
      this.gScoreStamp.fill(0);
      this.stamp = 1;
    }

    const stamp = this.stamp;
    const graph = this.graph;
    const closedStamp = this.closedStamp;
    const gScoreStamp = this.gScoreStamp;
    const gScore = this.gScore;
    const cameFrom = this.cameFrom;
    const startNode = this.startNode;
    const queue = this.queue;
    const weight = this.heuristicWeight;

    // Get goal node for heuristic
    const goalNode = graph.getNode(goalId);
    if (!goalNode) return null;
    const goalX = goalNode.x;
    const goalY = goalNode.y;

    // Initialize all start nodes
    queue.clear();
    for (const startId of startIds) {
      const node = graph.getNode(startId);
      if (!node) continue;

      gScore[startId] = 0;
      gScoreStamp[startId] = stamp;
      cameFrom[startId] = -1;
      startNode[startId] = startId; // each start is its own origin

      const h = weight * (Math.abs(node.x - goalX) + Math.abs(node.y - goalY));
      queue.push(startId, h);
    }

    let iterations = this.maxIterations;

    while (!queue.isEmpty()) {
      if (--iterations <= 0) {
        return null;
      }

      const current = queue.pop();

      if (closedStamp[current] === stamp) continue;
      closedStamp[current] = stamp;

      if (current === goalId) {
        return this.buildPathFromGoal(goalId);
      }

      const currentG = gScore[current];
      const currentStart = startNode[current];
      const edges = graph.getNodeEdges(current);

      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const neighbor = graph.getOtherNode(edge, current);

        if (closedStamp[neighbor] === stamp) continue;

        const tentativeG = currentG + edge.cost;

        if (gScoreStamp[neighbor] !== stamp || tentativeG < gScore[neighbor]) {
          cameFrom[neighbor] = current;
          gScore[neighbor] = tentativeG;
          gScoreStamp[neighbor] = stamp;
          startNode[neighbor] = currentStart; // propagate origin

          const neighborNode = graph.getNode(neighbor);
          if (neighborNode) {
            const h =
              weight *
              (Math.abs(neighborNode.x - goalX) +
                Math.abs(neighborNode.y - goalY));
            queue.push(neighbor, tentativeG + h);
          }
        }
      }
    }

    return null;
  }

  private buildPathFromGoal(goalId: number): number[] {
    const path: number[] = [];
    let current = goalId;

    while (current !== -1) {
      path.push(current);
      current = this.cameFrom[current];
    }

    path.reverse();
    return path;
  }
}
