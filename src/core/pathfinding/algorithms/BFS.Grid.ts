// 4-direction grid BFS with stamp-based visited tracking
export class BFSGrid {
  private stamp = 1;

  private readonly visitedStamp: Uint32Array;
  private readonly queue: Int32Array;
  private readonly dist: Uint16Array;

  constructor(numNodes: number) {
    this.visitedStamp = new Uint32Array(numNodes);
    this.queue = new Int32Array(numNodes);
    this.dist = new Uint16Array(numNodes);
  }

  /**
   * Grid BFS search with visitor pattern.
   * @param start - Starting node(s)
   * @param maxDistance - Maximum distance to search
   * @param isValidNode - Filter for traversable nodes
   * @param visitor - Called for each node:
   *   - Returns R: Found target, return immediately
   *   - Returns undefined: Valid node, explore neighbors
   *   - Returns null: Reject node, don't explore neighbors
   */
  search<R>(
    width: number,
    height: number,
    start: number | number[],
    maxDistance: number,
    isValidNode: (node: number) => boolean,
    visitor: (node: number, dist: number) => R | null | undefined,
  ): R | null {
    const stamp = this.nextStamp();
    const lastRowStart = (height - 1) * width;
    const starts = typeof start === "number" ? [start] : start;

    let head = 0;
    let tail = 0;

    for (const s of starts) {
      this.visitedStamp[s] = stamp;
      this.dist[s] = 0;
      this.queue[tail++] = s;
    }

    while (head < tail) {
      const node = this.queue[head++];
      const dist = this.dist[node];

      const result = visitor(node, dist);

      if (result !== null && result !== undefined) {
        return result;
      }

      if (result === null) {
        continue;
      }

      const nextDist = dist + 1;

      if (nextDist > maxDistance) {
        continue;
      }

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

    if (this.stamp > 0xffffffff) {
      this.visitedStamp.fill(0);
      this.stamp = 1;
    }

    return stamp;
  }
}
