import { GameMap, TileRef } from "../game/GameMap";
import { BezenhamLine } from "../utilities/Line";
import { MultiSourceAnyTargetBFSOptions } from "./MultiSourceAnyTargetBFS";

export type RubberBandPathResult = {
  waypoints: TileRef[];
  path: TileRef[];
};

export type OffshoreCleanupOptions = {
  /**
   * Square window size (in tiles) used to find the local maximum "depth" (distance-to-land).
   * Typical: 16.
   */
  windowSize?: number;
};

const depthDirs8 = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 },
] as const;

let depthScratchDist = new Int16Array(0);
let depthScratchQx = new Int16Array(0);
let depthScratchQy = new Int16Array(0);
let waypointScratchIn = new Int32Array(0);
let waypointScratchOut = new Int32Array(0);

function sign(n: number): -1 | 0 | 1 {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}

function lineOfSightWater(
  gm: GameMap,
  from: TileRef,
  to: TileRef,
  noCornerCutting: boolean,
): boolean {
  const w = gm.width();
  const x0 = gm.x(from);
  const y0 = gm.y(from);
  const x1 = gm.x(to);
  const y1 = gm.y(to);

  const line = new BezenhamLine({ x: x0, y: y0 }, { x: x1, y: y1 });

  let prevX = x0;
  let prevY = y0;
  let point = line.increment();
  while (point !== true) {
    const t = point.y * w + point.x;
    if (!gm.isWater(t)) return false;

    if (noCornerCutting) {
      const dx = sign(point.x - prevX);
      const dy = sign(point.y - prevY);
      if (dx !== 0 && dy !== 0) {
        const orthoA = prevY * w + (prevX + dx);
        const orthoB = (prevY + dy) * w + prevX;
        if (!gm.isWater(orthoA) || !gm.isWater(orthoB)) return false;
      }
    }

    prevX = point.x;
    prevY = point.y;
    point = line.increment();
  }

  return gm.isWater(to);
}

function expandLine(gm: GameMap, from: TileRef, to: TileRef, out: TileRef[]) {
  const w = gm.width();
  const x0 = gm.x(from);
  const y0 = gm.y(from);
  const x1 = gm.x(to);
  const y1 = gm.y(to);
  const line = new BezenhamLine({ x: x0, y: y0 }, { x: x1, y: y1 });
  let point = line.increment();
  while (point !== true) {
    const t = point.y * w + point.x;
    if (out.length === 0 || out[out.length - 1] !== t) out.push(t);
    point = line.increment();
  }
  if (out.length === 0 || out[out.length - 1] !== to) out.push(to);
}

function rubberBandWaypointsWater(
  gm: GameMap,
  path: readonly TileRef[],
  noCornerCutting: boolean,
): TileRef[] {
  if (path.length <= 2) return [...path];

  // Keep this bounded: tile paths can be long on big maps and LOS checks scan the segment.
  const maxLookahead = 4096;

  const waypoints: TileRef[] = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    const end = Math.min(path.length - 1, i + maxLookahead);

    // Adjacent step must be visible (the original path is valid water adjacency).
    let lo = i + 1;
    if (lo > end) break;

    const anchor = path[i]!;
    const endRef = path[end]!;
    if (lineOfSightWater(gm, anchor, endRef, noCornerCutting)) {
      waypoints.push(endRef);
      i = end;
      continue;
    }

    // Gallop forward to find an upper bound, then binary search for farthest visible.
    let step = 1;
    let hi = lo;
    while (hi < end) {
      const cand = Math.min(end, hi + step);
      if (cand === hi) break;
      const candRef = path[cand]!;
      if (lineOfSightWater(gm, anchor, candRef, noCornerCutting)) {
        lo = cand;
        hi = cand;
        step <<= 1;
        if (hi === end) break;
      } else {
        hi = cand;
        break;
      }
    }

    if (lo === end) {
      waypoints.push(path[lo]!);
      i = lo;
      continue;
    }

    let left = lo;
    let right = hi;
    while (left < right) {
      const mid = (left + right + 1) >> 1;
      const midRef = path[mid]!;
      if (lineOfSightWater(gm, anchor, midRef, noCornerCutting)) {
        left = mid;
      } else {
        right = mid - 1;
      }
    }

    waypoints.push(path[left]!);
    i = left;
  }
  return waypoints;
}

function snapWaypointsToLocalDepthMaxInPlace(
  gm: GameMap,
  waypoints: TileRef[],
  noCornerCutting: boolean,
  opts: OffshoreCleanupOptions,
) {
  if (waypoints.length <= 2) return;

  const windowSize = Math.max(4, opts.windowSize ?? 16);
  const half = Math.max(1, Math.floor(windowSize / 2));

  const w = gm.width();
  const h = gm.height();

  // Ensure scratch for a max windowSize*windowSize region.
  const maxN = windowSize * windowSize;
  if (depthScratchDist.length < maxN) {
    depthScratchDist = new Int16Array(maxN);
    depthScratchQx = new Int16Array(maxN);
    depthScratchQy = new Int16Array(maxN);
  }

  const count = waypoints.length;
  if (waypointScratchIn.length < count) {
    waypointScratchIn = new Int32Array(count);
    waypointScratchOut = new Int32Array(count);
  }
  for (let i = 0; i < count; i++) {
    const t = waypoints[i]!;
    waypointScratchIn[i] = t;
    waypointScratchOut[i] = t;
  }

  for (let i = 1; i < count - 1; i++) {
    const prev = waypointScratchIn[i - 1]! as TileRef;
    const curr = waypointScratchIn[i]! as TileRef;
    const next = waypointScratchIn[i + 1]! as TileRef;

    const cx = gm.x(curr);
    const cy = gm.y(curr);
    if (!gm.isWater(curr)) continue;

    const x0 = Math.max(0, cx - half);
    const y0 = Math.max(0, cy - half);
    const x1 = Math.min(w - 1, cx + (windowSize - half - 1));
    const y1 = Math.min(h - 1, cy + (windowSize - half - 1));
    const ww = x1 - x0 + 1;
    const wh = y1 - y0 + 1;
    const n = ww * wh;

    depthScratchDist.fill(-1, 0, n);

    // Multi-source BFS from land tiles inside the window to compute Chebyshev distance-to-land.
    let qh = 0;
    let qt = 0;
    let seeded = false;
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      const ly = y - y0;
      for (let x = x0; x <= x1; x++) {
        const t = row + x;
        if (gm.isWater(t)) continue;
        const lx = x - x0;
        const idx = ly * ww + lx;
        depthScratchDist[idx] = 0;
        depthScratchQx[qt] = lx;
        depthScratchQy[qt] = ly;
        qt++;
        seeded = true;
      }
    }
    if (!seeded) continue;

    while (qh < qt) {
      const lx = depthScratchQx[qh]!;
      const ly = depthScratchQy[qh]!;
      const idx = ly * ww + lx;
      const nd = (depthScratchDist[idx]! + 1) as number;
      qh++;

      for (const { dx, dy } of depthDirs8) {
        const nx = lx + dx;
        const ny = ly + dy;
        if (nx < 0 || nx >= ww || ny < 0 || ny >= wh) continue;
        const nidx = ny * ww + nx;
        if (depthScratchDist[nidx] !== -1) continue;
        depthScratchDist[nidx] = nd as any;
        depthScratchQx[qt] = nx;
        depthScratchQy[qt] = ny;
        qt++;
      }
    }

    // Pick the local maximum depth water tile that preserves LOS to prev/next.
    let bestTile: TileRef = curr;
    let bestDepth = -1;
    let bestDist2 = 0;

    for (let ly = 0; ly < wh; ly++) {
      const row = (y0 + ly) * w;
      const base = ly * ww;
      for (let lx = 0; lx < ww; lx++) {
        const t = row + (x0 + lx);
        if (!gm.isWater(t)) continue;
        const depth = depthScratchDist[base + lx]!;
        // Must preserve the sparse-path invariant: segments remain LOS-water.
        if (
          !lineOfSightWater(gm, prev, t, noCornerCutting) ||
          !lineOfSightWater(gm, t, next, noCornerCutting)
        ) {
          continue;
        }
        const dx = (x0 + lx) - cx;
        const dy = (y0 + ly) - cy;
        const d2 = dx * dx + dy * dy;

        if (
          depth > bestDepth ||
          (depth === bestDepth && d2 < bestDist2)
        ) {
          bestDepth = depth;
          bestDist2 = d2;
          bestTile = t;
        }
      }
    }

    waypointScratchOut[i] = bestTile;
  }

  // Validate that consecutive segments remain LOS-water after simultaneous snapping.
  for (let i = 0; i < count - 1; i++) {
    const a = waypointScratchOut[i]! as TileRef;
    const b = waypointScratchOut[i + 1]! as TileRef;
    if (!lineOfSightWater(gm, a, b, noCornerCutting)) {
      return; // Conservative: keep pass1 waypoints unchanged.
    }
  }

  for (let i = 0; i < count; i++) {
    waypoints[i] = waypointScratchOut[i]! as TileRef;
  }
}

/**
 * Reduce "staircase inflation" in the coarse corridor by replacing zig-zaggy coarse paths
 * with a line-of-sight spine, then expanding that spine back into a contiguous coarse-cell list.
 *
 * This is a performance optimization only; correctness is preserved by mask expansion + fine fallback.
 */
export function rubberBandCoarsePath(
  coarseMap: GameMap,
  coarsePath: readonly TileRef[],
  bfsOpts: MultiSourceAnyTargetBFSOptions,
): TileRef[] {
  if (coarsePath.length <= 2) return [...coarsePath];

  const kingMoves = bfsOpts.kingMoves ?? true;
  if (!kingMoves) return [...coarsePath];
  const noCornerCutting = bfsOpts.noCornerCutting ?? true;

  // Keep this bounded: coarse paths can be long on big maps.
  const maxLookahead = 1024;
  const maxChecksPerAnchor = 64;

  const waypoints: TileRef[] = [coarsePath[0]!];
  let i = 0;
  while (i < coarsePath.length - 1) {
    const end = Math.min(coarsePath.length - 1, i + maxLookahead);
    let best = i + 1;
    let checks = 0;
    for (let j = end; j > i; j--) {
      if (lineOfSightWater(coarseMap, coarsePath[i]!, coarsePath[j]!, noCornerCutting)) {
        best = j;
        break;
      }
      if (++checks >= maxChecksPerAnchor) break;
    }
    waypoints.push(coarsePath[best]!);
    i = best;
  }

  const spine: TileRef[] = [];
  for (let k = 0; k < waypoints.length - 1; k++) {
    expandLine(coarseMap, waypoints[k]!, waypoints[k + 1]!, spine);
  }
  return spine.length > 0 ? spine : [...coarsePath];
}

/**
 * "String pulling" / rubber banding for a water-only tile path.
 *
 * Returns both:
 * - `waypoints`: a sparse polyline (for rendering/splines later)
 * - `path`: a tile-valid path expanded along the waypoint segments
 *
 * This is bounded (lookahead + checks per anchor) to keep it hot-path friendly.
 */
export function rubberBandWaterPath(
  gm: GameMap,
  waterPath: readonly TileRef[],
  bfsOpts: MultiSourceAnyTargetBFSOptions,
  offshore?: OffshoreCleanupOptions,
): RubberBandPathResult {
  if (waterPath.length <= 2) {
    return { waypoints: [...waterPath], path: [...waterPath] };
  }

  const kingMoves = bfsOpts.kingMoves ?? true;
  if (!kingMoves) return { waypoints: [...waterPath], path: [...waterPath] };
  const noCornerCutting = bfsOpts.noCornerCutting ?? true;

  // Pass 1: waypoint-only rubber banding (no tile reconstruction yet).
  let waypoints = rubberBandWaypointsWater(gm, waterPath, noCornerCutting);

  // Pass 2: snap each interior waypoint to the local window maximum "depth" (distance to land),
  // without adding/removing waypoints. This keeps segments LOS-water by construction.
  if (offshore) {
    snapWaypointsToLocalDepthMaxInPlace(gm, waypoints, noCornerCutting, offshore);
  }

  // Final: expand the waypoint polyline once into a tile-valid path.
  const out: TileRef[] = [];
  for (let k = 0; k < waypoints.length - 1; k++) {
    expandLine(gm, waypoints[k]!, waypoints[k + 1]!, out);
  }

  return out.length > 0
    ? { waypoints, path: out }
    : { waypoints: [...waterPath], path: [...waterPath] };
}
