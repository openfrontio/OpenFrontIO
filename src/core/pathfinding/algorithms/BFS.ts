// Generic BFS implementation with adapter interface

export interface BFSAdapter<T> {
  neighbors(node: T): T[];
}

export class BFS<T> {
  constructor(private adapter: BFSAdapter<T>) {}

  /**
   * BFS search with visitor pattern.
   * @param start - Starting node(s)
   * @param maxDistance - Maximum distance to search (Infinity for unlimited)
   * @param visitor - Called for each node:
   *   - Returns R: Found target, return immediately
   *   - Returns undefined: Valid node, explore neighbors
   *   - Returns null: Reject node, don't explore neighbors
   */
  search<R>(
    start: T | T[],
    maxDistance: number,
    visitor: (node: T, dist: number) => R | null | undefined,
  ): R | null {
    const visited = new Set<T>();
    const queue: { node: T; dist: number }[] = [];
    const starts = Array.isArray(start) ? start : [start];

    for (const s of starts) {
      visited.add(s);
      queue.push({ node: s, dist: 0 });
    }

    while (queue.length > 0) {
      const { node, dist } = queue.shift()!;

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

      for (const neighbor of this.adapter.neighbors(node)) {
        if (visited.has(neighbor)) {
          continue;
        }

        visited.add(neighbor);
        queue.push({ node: neighbor, dist: nextDist });
      }
    }

    return null;
  }
}
