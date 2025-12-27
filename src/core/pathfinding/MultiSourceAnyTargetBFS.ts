import { GameMap, TileRef } from "../game/GameMap";

export type MultiSourceAnyTargetBFSResult = {
  source: TileRef;
  target: TileRef;
  path: TileRef[];
};

export type MultiSourceAnyTargetBFSOptions = {
  kingMoves?: boolean;
  noCornerCutting?: boolean;
};

/**
 * Multi-source, any-target BFS for TileRef graphs.
 *
 * - Unweighted (edge cost == 1).
 * - Early-exit is correct when terminating on target *dequeue* (pop), not discovery.
 * - Designed for reuse: allocates typed arrays once.
 */
export class MultiSourceAnyTargetBFS {
  private stamp = 1;
  private readonly visitedStamp: Uint32Array;
  private readonly targetStamp: Uint32Array;
  private readonly prev: Int32Array;
  private readonly startOf: Int32Array;
  private readonly queue: Int32Array;

  constructor(numTiles: number) {
    this.visitedStamp = new Uint32Array(numTiles);
    this.targetStamp = new Uint32Array(numTiles);
    this.prev = new Int32Array(numTiles);
    this.startOf = new Int32Array(numTiles);
    this.queue = new Int32Array(numTiles);
  }

  findWaterPath(
    gm: GameMap,
    sources: readonly TileRef[],
    targets: readonly TileRef[],
    opts: MultiSourceAnyTargetBFSOptions = {},
  ): MultiSourceAnyTargetBFSResult | null {
    return this.findWaterPathFromSeeds(gm, sources, sources, targets, opts);
  }

  findWaterPathFromSeeds(
    gm: GameMap,
    seedNodes: readonly TileRef[],
    seedOrigins: readonly TileRef[],
    targets: readonly TileRef[],
    opts: MultiSourceAnyTargetBFSOptions = {},
  ): MultiSourceAnyTargetBFSResult | null {
    if (seedNodes.length === 0 || targets.length === 0) return null;

    const stamp = this.nextStamp();

    for (const t of targets) {
      if (t >= 0 && t < this.targetStamp.length) {
        this.targetStamp[t] = stamp;
      }
    }

    const w = gm.width();
    const h = gm.height();
    const lastRowStart = (h - 1) * w;

    let head = 0;
    let tail = 0;

    const count = Math.min(seedNodes.length, seedOrigins.length);
    for (let i = 0; i < count; i++) {
      const node = seedNodes[i]!;
      const origin = seedOrigins[i]!;
      if (node < 0 || node >= this.visitedStamp.length) continue;
      if (!gm.isWater(node)) continue;
      if (this.visitedStamp[node] === stamp) continue;
      this.visitedStamp[node] = stamp;
      this.prev[node] = -1;
      this.startOf[node] = origin;
      this.queue[tail++] = node;
    }

    if (tail === 0) return null;

    const kingMoves = opts.kingMoves ?? true;
    const noCornerCutting = opts.noCornerCutting ?? true;

    while (head < tail) {
      const node = this.queue[head++] as TileRef;

      if (this.targetStamp[node] === stamp) {
        return {
          source: this.startOf[node] as TileRef,
          target: node,
          path: this.reconstructPath(node),
        };
      }

      const x = gm.x(node);

      // Orthogonal neighbors
      if (node >= w) {
        const n = node - w;
        if (gm.isWater(n) && this.visitedStamp[n] !== stamp) {
          this.visit(n, node, stamp);
          this.queue[tail++] = n;
        }
      }
      if (node < lastRowStart) {
        const s = node + w;
        if (gm.isWater(s) && this.visitedStamp[s] !== stamp) {
          this.visit(s, node, stamp);
          this.queue[tail++] = s;
        }
      }
      if (x !== 0) {
        const wv = node - 1;
        if (gm.isWater(wv) && this.visitedStamp[wv] !== stamp) {
          this.visit(wv, node, stamp);
          this.queue[tail++] = wv;
        }
      }
      if (x !== w - 1) {
        const ev = node + 1;
        if (gm.isWater(ev) && this.visitedStamp[ev] !== stamp) {
          this.visit(ev, node, stamp);
          this.queue[tail++] = ev;
        }
      }

      if (!kingMoves) continue;

      // Diagonals (king moves). With noCornerCutting, forbid squeezing past land corners.
      if (node >= w && x !== 0) {
        const nw = node - w - 1;
        if (
          gm.isWater(nw) &&
          (!noCornerCutting || (gm.isWater(node - w) && gm.isWater(node - 1))) &&
          this.visitedStamp[nw] !== stamp
        ) {
          this.visit(nw, node, stamp);
          this.queue[tail++] = nw;
        }
      }
      if (node >= w && x !== w - 1) {
        const ne = node - w + 1;
        if (
          gm.isWater(ne) &&
          (!noCornerCutting || (gm.isWater(node - w) && gm.isWater(node + 1))) &&
          this.visitedStamp[ne] !== stamp
        ) {
          this.visit(ne, node, stamp);
          this.queue[tail++] = ne;
        }
      }
      if (node < lastRowStart && x !== 0) {
        const sw = node + w - 1;
        if (
          gm.isWater(sw) &&
          (!noCornerCutting || (gm.isWater(node + w) && gm.isWater(node - 1))) &&
          this.visitedStamp[sw] !== stamp
        ) {
          this.visit(sw, node, stamp);
          this.queue[tail++] = sw;
        }
      }
      if (node < lastRowStart && x !== w - 1) {
        const se = node + w + 1;
        if (
          gm.isWater(se) &&
          (!noCornerCutting || (gm.isWater(node + w) && gm.isWater(node + 1))) &&
          this.visitedStamp[se] !== stamp
        ) {
          this.visit(se, node, stamp);
          this.queue[tail++] = se;
        }
      }
    }

    return null;
  }

  private visit(node: TileRef, from: TileRef, stamp: number) {
    this.visitedStamp[node] = stamp;
    this.prev[node] = from;
    this.startOf[node] = this.startOf[from];
  }

  private reconstructPath(target: TileRef): TileRef[] {
    const out: TileRef[] = [];
    let curr: number = target;
    while (curr !== -1) {
      out.push(curr);
      curr = this.prev[curr];
    }
    out.reverse();
    return out;
  }

  private nextStamp(): number {
    const next = (this.stamp + 1) >>> 0;
    this.stamp = next === 0 ? 1 : next;
    return this.stamp;
  }
}
