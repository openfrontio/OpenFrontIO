export interface FastBFSAdapter<T> {
  visitor(node: number, dist: number): T | null | undefined;
  isValidNode(node: number): boolean;
}

// Optimized BFS using stamp-based visited tracking and typed array queue
export class FastBFS {
  private stamp = 1;
  private readonly visitedStamp: Uint32Array;
  private readonly queue: Int32Array;
  private readonly dist: Uint16Array;

  constructor(numNodes: number) {
    this.visitedStamp = new Uint32Array(numNodes);
    this.queue = new Int32Array(numNodes);
    this.dist = new Uint16Array(numNodes);
  }

  search<T>(
    width: number,
    height: number,
    start: number,
    maxDistance: number,
    isValidNode: FastBFSAdapter<T>["isValidNode"],
    visitor: FastBFSAdapter<T>["visitor"],
  ): T | null {
    const stamp = this.nextStamp();
    const lastRowStart = (height - 1) * width;

    let head = 0;
    let tail = 0;

    this.visitedStamp[start] = stamp;
    this.dist[start] = 0;
    this.queue[tail++] = start;

    while (head < tail) {
      const node = this.queue[head++];
      const currentDist = this.dist[node];

      if (currentDist > maxDistance) {
        continue;
      }

      // Call visitor:
      // - Returns T: Found target, return immediately
      // - Returns null: Reject tile, don't explore neighbors
      // - Returns undefined: Valid tile, explore neighbors
      const result = visitor(node, currentDist);

      if (result !== null && result !== undefined) {
        return result;
      }

      // If visitor returned null, reject this tile and don't explore neighbors
      if (result === null) {
        continue;
      }

      const nextDist = currentDist + 1;
      const x = node % width;

      // North
      if (node >= width) {
        const n = node - width;
        if (this.visitedStamp[n] !== stamp && isValidNode(n)) {
          this.visitedStamp[n] = stamp;
          this.dist[n] = nextDist;
          this.queue[tail++] = n;
        }
      }

      // South
      if (node < lastRowStart) {
        const s = node + width;
        if (this.visitedStamp[s] !== stamp && isValidNode(s)) {
          this.visitedStamp[s] = stamp;
          this.dist[s] = nextDist;
          this.queue[tail++] = s;
        }
      }

      // West
      if (x !== 0) {
        const wv = node - 1;
        if (this.visitedStamp[wv] !== stamp && isValidNode(wv)) {
          this.visitedStamp[wv] = stamp;
          this.dist[wv] = nextDist;
          this.queue[tail++] = wv;
        }
      }

      // East
      if (x !== width - 1) {
        const ev = node + 1;
        if (this.visitedStamp[ev] !== stamp && isValidNode(ev)) {
          this.visitedStamp[ev] = stamp;
          this.dist[ev] = nextDist;
          this.queue[tail++] = ev;
        }
      }
    }

    return null;
  }

  private nextStamp(): number {
    const stamp = this.stamp++;

    if (this.stamp === 0) {
      // Overflow - reset (extremely rare)
      this.visitedStamp.fill(0);
      this.stamp = 1;
    }

    return stamp;
  }
}
