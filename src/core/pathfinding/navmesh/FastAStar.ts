// A* optimized for performance for small to medium graphs.
// Works with node IDs represented as integers (0 to numNodes-1)

export interface FastAStarAdapter {
  getNeighbors(node: number): number[];
  getCost(from: number, to: number): number;
  heuristic(node: number, goal: number): number;
}

// Simple binary min-heap for open set using typed arrays
class MinHeap {
  private heap: Int32Array;
  private scores: Float32Array;
  private size = 0;

  constructor(capacity: number, scores: Float32Array) {
    this.heap = new Int32Array(capacity);
    this.scores = scores;
  }

  push(node: number): void {
    let i = this.size++;
    this.heap[i] = node;

    // Bubble up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.scores[this.heap[parent]] <= this.scores[this.heap[i]]) {
        break;
      }

      // Swap
      const tmp = this.heap[parent];
      this.heap[parent] = this.heap[i];
      this.heap[i] = tmp;
      i = parent;
    }
  }

  pop(): number {
    const result = this.heap[0];
    this.heap[0] = this.heap[--this.size];

    // Bubble down
    let i = 0;
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;

      if (
        left < this.size &&
        this.scores[this.heap[left]] < this.scores[this.heap[smallest]]
      ) {
        smallest = left;
      }

      if (
        right < this.size &&
        this.scores[this.heap[right]] < this.scores[this.heap[smallest]]
      ) {
        smallest = right;
      }

      if (smallest === i) {
        break;
      }

      // Swap
      const tmp = this.heap[smallest];
      this.heap[smallest] = this.heap[i];
      this.heap[i] = tmp;
      i = smallest;
    }

    return result;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  clear(): void {
    this.size = 0;
  }
}

export class FastAStar {
  private stamp = 1;
  private readonly closedStamp: Uint32Array; // Tracks fully processed nodes
  private readonly gScoreStamp: Uint32Array; // Tracks valid gScores
  private readonly gScore: Float32Array;
  private readonly fScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly openHeap: MinHeap;

  constructor(numNodes: number) {
    this.closedStamp = new Uint32Array(numNodes);
    this.gScoreStamp = new Uint32Array(numNodes);
    this.gScore = new Float32Array(numNodes);
    this.fScore = new Float32Array(numNodes);
    this.cameFrom = new Int32Array(numNodes);
    this.openHeap = new MinHeap(numNodes, this.fScore);
  }

  private nextStamp(): number {
    const stamp = this.stamp++;

    if (this.stamp === 0) {
      // Overflow - reset (extremely rare)
      this.closedStamp.fill(0);
      this.gScoreStamp.fill(0);
      this.stamp = 1;
    }

    return stamp;
  }

  search(
    start: number,
    goal: number,
    adapter: FastAStarAdapter,
    maxIterations: number = 100000,
  ): number[] | null {
    const stamp = this.nextStamp();

    this.openHeap.clear();
    this.gScore[start] = 0;
    this.gScoreStamp[start] = stamp;
    this.fScore[start] = adapter.heuristic(start, goal);
    this.cameFrom[start] = -1;
    this.openHeap.push(start);

    let iterations = 0;

    while (!this.openHeap.isEmpty() && iterations < maxIterations) {
      iterations++;

      const current = this.openHeap.pop();

      // Skip if already processed (duplicate from heap)
      if (this.closedStamp[current] === stamp) {
        continue;
      }

      // Mark as processed
      this.closedStamp[current] = stamp;

      // Found goal
      if (current === goal) {
        return this.reconstructPath(start, goal);
      }

      const neighbors = adapter.getNeighbors(current);
      const currentGScore = this.gScore[current];

      for (const neighbor of neighbors) {
        // Skip already processed neighbors
        if (this.closedStamp[neighbor] === stamp) {
          continue;
        }

        const tentativeGScore =
          currentGScore + adapter.getCost(current, neighbor);

        // If we haven't visited this neighbor yet, or found a better path
        const hasValidGScore = this.gScoreStamp[neighbor] === stamp;
        if (!hasValidGScore || tentativeGScore < this.gScore[neighbor]) {
          this.cameFrom[neighbor] = current;
          this.gScore[neighbor] = tentativeGScore;
          this.gScoreStamp[neighbor] = stamp;
          this.fScore[neighbor] =
            tentativeGScore + adapter.heuristic(neighbor, goal);

          // Add to heap (allow duplicates for better paths)
          this.openHeap.push(neighbor);
        }
      }
    }

    return null;
  }

  private reconstructPath(start: number, goal: number): number[] {
    const path: number[] = [];
    let current = goal;

    while (current !== start) {
      path.push(current);
      current = this.cameFrom[current];

      // Safety check
      if (current === -1) {
        return [];
      }
    }

    path.push(start);
    path.reverse();
    return path;
  }
}
