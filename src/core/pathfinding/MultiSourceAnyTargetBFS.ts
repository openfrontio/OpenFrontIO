import { GameMap, TileRef } from "../game/GameMap";

export type MultiSourceAnyTargetBFSResult = {
  source: TileRef;
  target: TileRef;
  path: TileRef[];
};

export type MultiSourceAnyTargetBFSOptions = {
  kingMoves?: boolean;
  noCornerCutting?: boolean;
  /**
   * Optional region mask to restrict traversal.
   *
   * Intended for coarse-to-fine corridors: map each fine tile to a coarse region and
   * allow only regions whose stamp matches.
   */
  allowedMask?: {
    tileToRegion: Uint32Array;
    regionStamp: Uint32Array;
    stamp: number;
  };
  /**
   * Optional region marking output.
   *
   * Intended for local corridor widening: during BFS, mark which coarse regions were
   * actually visited (cheap stamp write, allocation-free).
   */
  visitedMaskOut?: {
    tileToRegion: Uint32Array;
    regionStamp: Uint32Array;
    stamp: number;
  };
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

  // Scratch for mask-expanding searches (allocated lazily).
  private deferredStamp?: Uint32Array;
  private deferredPrev?: Int32Array;
  private deferredNext?: Int32Array;
  private deferredRegionHead?: Int32Array;
  private deferredRegionTouched?: Int32Array;
  private deferredRegionTouchedCount = 0;
  private deferredRegionsSize = 0;
  private newlyAllowedRegions?: Int32Array;

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

    const allowed = opts.allowedMask;
    const visitedOut = opts.visitedMaskOut;

    const count = Math.min(seedNodes.length, seedOrigins.length);
    for (let i = 0; i < count; i++) {
      const node = seedNodes[i]!;
      const origin = seedOrigins[i]!;
      if (node < 0 || node >= this.visitedStamp.length) continue;
      if (
        allowed &&
        allowed.regionStamp[allowed.tileToRegion[node]!] !== allowed.stamp
      ) {
        continue;
      }
      if (!gm.isWater(node)) continue;
      if (this.visitedStamp[node] === stamp) continue;
      this.visitedStamp[node] = stamp;
      this.prev[node] = -1;
      this.startOf[node] = origin;
      if (visitedOut) {
        visitedOut.regionStamp[visitedOut.tileToRegion[node]!] = visitedOut.stamp;
      }
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
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[n]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(n, node, stamp, visitedOut);
            this.queue[tail++] = n;
          }
        }
      }
      if (node < lastRowStart) {
        const s = node + w;
        if (gm.isWater(s) && this.visitedStamp[s] !== stamp) {
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[s]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(s, node, stamp, visitedOut);
            this.queue[tail++] = s;
          }
        }
      }
      if (x !== 0) {
        const wv = node - 1;
        if (gm.isWater(wv) && this.visitedStamp[wv] !== stamp) {
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[wv]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(wv, node, stamp, visitedOut);
            this.queue[tail++] = wv;
          }
        }
      }
      if (x !== w - 1) {
        const ev = node + 1;
        if (gm.isWater(ev) && this.visitedStamp[ev] !== stamp) {
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[ev]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(ev, node, stamp, visitedOut);
            this.queue[tail++] = ev;
          }
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
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[nw]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(nw, node, stamp, visitedOut);
            this.queue[tail++] = nw;
          }
        }
      }
      if (node >= w && x !== w - 1) {
        const ne = node - w + 1;
        if (
          gm.isWater(ne) &&
          (!noCornerCutting || (gm.isWater(node - w) && gm.isWater(node + 1))) &&
          this.visitedStamp[ne] !== stamp
        ) {
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[ne]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(ne, node, stamp, visitedOut);
            this.queue[tail++] = ne;
          }
        }
      }
      if (node < lastRowStart && x !== 0) {
        const sw = node + w - 1;
        if (
          gm.isWater(sw) &&
          (!noCornerCutting || (gm.isWater(node + w) && gm.isWater(node - 1))) &&
          this.visitedStamp[sw] !== stamp
        ) {
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[sw]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(sw, node, stamp, visitedOut);
            this.queue[tail++] = sw;
          }
        }
      }
      if (node < lastRowStart && x !== w - 1) {
        const se = node + w + 1;
        if (
          gm.isWater(se) &&
          (!noCornerCutting || (gm.isWater(node + w) && gm.isWater(node + 1))) &&
          this.visitedStamp[se] !== stamp
        ) {
          if (
            allowed &&
            allowed.regionStamp[allowed.tileToRegion[se]!] !== allowed.stamp
          ) {
            // skip
          } else {
            this.visit(se, node, stamp, visitedOut);
            this.queue[tail++] = se;
          }
        }
      }
    }

    return null;
  }

  /**
   * Like `findWaterPathFromSeeds`, but supports expanding `opts.allowedMask` without restarting.
   *
   * When the queue exhausts, calls `onQueueEmpty(outNewlyAllowedRegions)`:
   * - the callback should widen the allowed mask in-place and return how many coarse regions were newly allowed
   * - if it returns 0, the search stops and returns null
   *
   * This is the "mask-expanding BFS" fast variant: it is sound (finds a valid path if one exists
   * under the eventually allowed regions), but it is not guaranteed to be shortest under the final
   * expanded region set.
   */
  findWaterPathFromSeedsMaskExpanding(
    gm: GameMap,
    seedNodes: readonly TileRef[],
    seedOrigins: readonly TileRef[],
    targets: readonly TileRef[],
    opts: MultiSourceAnyTargetBFSOptions,
    onQueueEmpty: (outNewlyAllowedRegions: Int32Array) => number,
  ): MultiSourceAnyTargetBFSResult | null {
    if (seedNodes.length === 0 || targets.length === 0) return null;

    const allowed = opts.allowedMask;
    if (!allowed) {
      return this.findWaterPathFromSeeds(
        gm,
        seedNodes,
        seedOrigins,
        targets,
        opts,
      );
    }

    this.ensureMaskExpandingScratch(allowed.regionStamp.length);

    const deferredStamp = this.deferredStamp!;
    const deferredPrev = this.deferredPrev!;
    const deferredNext = this.deferredNext!;
    const regionHead = this.deferredRegionHead!;
    const touched = this.deferredRegionTouched!;
    const outNewRegions = this.newlyAllowedRegions!;

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

    const visitedOut = opts.visitedMaskOut;

    const count = Math.min(seedNodes.length, seedOrigins.length);
    for (let i = 0; i < count; i++) {
      const node = seedNodes[i]!;
      const origin = seedOrigins[i]!;
      if (node < 0 || node >= this.visitedStamp.length) continue;
      if (
        allowed.regionStamp[allowed.tileToRegion[node]!] !== allowed.stamp
      ) {
        continue;
      }
      if (!gm.isWater(node)) continue;
      if (this.visitedStamp[node] === stamp) continue;
      this.visitedStamp[node] = stamp;
      this.prev[node] = -1;
      this.startOf[node] = origin;
      if (visitedOut) {
        visitedOut.regionStamp[visitedOut.tileToRegion[node]!] =
          visitedOut.stamp;
      }
      this.queue[tail++] = node;
    }

    if (tail === 0) return null;

    const kingMoves = opts.kingMoves ?? true;
    const noCornerCutting = opts.noCornerCutting ?? true;

    const defer = (tile: TileRef, from: TileRef) => {
      if (tile < 0 || tile >= deferredStamp.length) return;
      if (deferredStamp[tile] === stamp) return;
      const region = allowed.tileToRegion[tile]!;
      deferredStamp[tile] = stamp;
      deferredPrev[tile] = from;
      deferredNext[tile] = regionHead[region]!;
      if (regionHead[region] === -1) {
        touched[this.deferredRegionTouchedCount++] = region;
      }
      regionHead[region] = tile;
    };

    const activateNewRegions = (newCount: number) => {
      for (let i = 0; i < newCount; i++) {
        const region = outNewRegions[i]!;
        let tile = regionHead[region]!;
        regionHead[region] = -1;
        while (tile !== -1) {
          const next = deferredNext[tile]!;
          if (
            this.visitedStamp[tile] !== stamp &&
            allowed.regionStamp[allowed.tileToRegion[tile]!] === allowed.stamp
          ) {
            // Deferred tiles are always water (we only defer after gm.isWater check),
            // so we can skip re-checking gm.isWater here.
            this.visit(tile, deferredPrev[tile]! as TileRef, stamp, visitedOut);
            this.queue[tail++] = tile;
          }
          tile = next;
        }
      }
    };

    for (;;) {
      while (head < tail) {
        const node = this.queue[head++] as TileRef;

        if (this.targetStamp[node] === stamp) {
          this.resetTouchedRegions(regionHead, touched);
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
            if (
              allowed.regionStamp[allowed.tileToRegion[n]!] !== allowed.stamp
            ) {
              defer(n, node);
            } else {
              this.visit(n, node, stamp, visitedOut);
              this.queue[tail++] = n;
            }
          }
        }
        if (node < lastRowStart) {
          const s = node + w;
          if (gm.isWater(s) && this.visitedStamp[s] !== stamp) {
            if (
              allowed.regionStamp[allowed.tileToRegion[s]!] !== allowed.stamp
            ) {
              defer(s, node);
            } else {
              this.visit(s, node, stamp, visitedOut);
              this.queue[tail++] = s;
            }
          }
        }
        if (x !== 0) {
          const wv = node - 1;
          if (gm.isWater(wv) && this.visitedStamp[wv] !== stamp) {
            if (
              allowed.regionStamp[allowed.tileToRegion[wv]!] !== allowed.stamp
            ) {
              defer(wv, node);
            } else {
              this.visit(wv, node, stamp, visitedOut);
              this.queue[tail++] = wv;
            }
          }
        }
        if (x !== w - 1) {
          const ev = node + 1;
          if (gm.isWater(ev) && this.visitedStamp[ev] !== stamp) {
            if (
              allowed.regionStamp[allowed.tileToRegion[ev]!] !== allowed.stamp
            ) {
              defer(ev, node);
            } else {
              this.visit(ev, node, stamp, visitedOut);
              this.queue[tail++] = ev;
            }
          }
        }

        if (!kingMoves) continue;

        // Diagonals (king moves). With noCornerCutting, forbid squeezing past land corners.
        if (node >= w && x !== 0) {
          const nw = node - w - 1;
          if (
            gm.isWater(nw) &&
            (!noCornerCutting ||
              (gm.isWater(node - w) && gm.isWater(node - 1))) &&
            this.visitedStamp[nw] !== stamp
          ) {
            if (
              allowed.regionStamp[allowed.tileToRegion[nw]!] !== allowed.stamp
            ) {
              defer(nw, node);
            } else {
              this.visit(nw, node, stamp, visitedOut);
              this.queue[tail++] = nw;
            }
          }
        }
        if (node >= w && x !== w - 1) {
          const ne = node - w + 1;
          if (
            gm.isWater(ne) &&
            (!noCornerCutting ||
              (gm.isWater(node - w) && gm.isWater(node + 1))) &&
            this.visitedStamp[ne] !== stamp
          ) {
            if (
              allowed.regionStamp[allowed.tileToRegion[ne]!] !== allowed.stamp
            ) {
              defer(ne, node);
            } else {
              this.visit(ne, node, stamp, visitedOut);
              this.queue[tail++] = ne;
            }
          }
        }
        if (node < lastRowStart && x !== 0) {
          const sw = node + w - 1;
          if (
            gm.isWater(sw) &&
            (!noCornerCutting ||
              (gm.isWater(node + w) && gm.isWater(node - 1))) &&
            this.visitedStamp[sw] !== stamp
          ) {
            if (
              allowed.regionStamp[allowed.tileToRegion[sw]!] !== allowed.stamp
            ) {
              defer(sw, node);
            } else {
              this.visit(sw, node, stamp, visitedOut);
              this.queue[tail++] = sw;
            }
          }
        }
        if (node < lastRowStart && x !== w - 1) {
          const se = node + w + 1;
          if (
            gm.isWater(se) &&
            (!noCornerCutting ||
              (gm.isWater(node + w) && gm.isWater(node + 1))) &&
            this.visitedStamp[se] !== stamp
          ) {
            if (
              allowed.regionStamp[allowed.tileToRegion[se]!] !== allowed.stamp
            ) {
              defer(se, node);
            } else {
              this.visit(se, node, stamp, visitedOut);
              this.queue[tail++] = se;
            }
          }
        }
      }

      // Queue exhausted under current mask.
      const newCount = onQueueEmpty(outNewRegions);
      if (newCount <= 0) break;
      activateNewRegions(newCount);
      // If expansion didn't actually yield any new reachable nodes, we'll loop back and exhaust again.
    }

    this.resetTouchedRegions(regionHead, touched);
    return null;
  }

  private visit(
    node: TileRef,
    from: TileRef,
    stamp: number,
    visitedOut: MultiSourceAnyTargetBFSOptions["visitedMaskOut"],
  ) {
    this.visitedStamp[node] = stamp;
    this.prev[node] = from;
    this.startOf[node] = this.startOf[from];
    if (visitedOut) {
      visitedOut.regionStamp[visitedOut.tileToRegion[node]!] = visitedOut.stamp;
    }
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

  private ensureMaskExpandingScratch(regionCount: number) {
    if (!this.deferredStamp) {
      const n = this.visitedStamp.length;
      this.deferredStamp = new Uint32Array(n);
      this.deferredPrev = new Int32Array(n);
      this.deferredNext = new Int32Array(n);
    }
    if (!this.deferredRegionHead || this.deferredRegionsSize !== regionCount) {
      this.deferredRegionsSize = regionCount;
      this.deferredRegionHead = new Int32Array(regionCount);
      this.deferredRegionHead.fill(-1);
      this.deferredRegionTouched = new Int32Array(regionCount);
      this.newlyAllowedRegions = new Int32Array(regionCount);
    }
    this.deferredRegionTouchedCount = 0;
  }

  private resetTouchedRegions(regionHead: Int32Array, touched: Int32Array) {
    for (let i = 0; i < this.deferredRegionTouchedCount; i++) {
      regionHead[touched[i]!] = -1;
    }
    this.deferredRegionTouchedCount = 0;
  }
}
