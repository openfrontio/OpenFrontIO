import { GameMap, TileRef } from "../game/GameMap";
import { BezenhamLine } from "../utilities/Line";
import { MultiSourceAnyTargetBFSOptions } from "./MultiSourceAnyTargetBFS";

export type RubberBandPathResult = {
  waypoints: TileRef[];
  path: TileRef[];
  /**
   * Optional sampled spline in tile coordinates (x,y pairs), intended for rendering.
   * This does not affect the tile-valid `path`.
   */
  spline?: number[];
};

export type OffshoreCleanupOptions = {
  /**
   * Square window size (in tiles) used to find the local maximum "depth" (distance-to-land).
   *
   * Must be odd so the window is symmetric around the waypoint (even sizes bias by 1 tile).
   * Typical: 33.
   */
  windowSize?: number;
};

export type WaypointSplineOptions = {
  enabled?: boolean;
  /**
   * Number of samples per waypoint segment (higher = smoother).
   * Typical: 4..8.
   */
  samplesPerSegment?: number;
  /**
   * Catmull-Rom tension (0..1). Typical: 0.5.
   */
  tension?: number;
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

function catmullRom1D(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
  tension: number,
): number {
  // Standard Catmull-Rom (cubic Hermite form).
  const t2 = t * t;
  const t3 = t2 * t;
  const m1 = (p2 - p0) * tension;
  const m2 = (p3 - p1) * tension;
  return (
    (2 * t3 - 3 * t2 + 1) * p1 +
    (t3 - 2 * t2 + t) * m1 +
    (-2 * t3 + 3 * t2) * p2 +
    (t3 - t2) * m2
  );
}

function buildWaypointSplineSamples(
  gm: GameMap,
  waypoints: readonly TileRef[],
  noCornerCutting: boolean,
  opts: WaypointSplineOptions,
): number[] | undefined {
  const enabled = opts.enabled ?? true;
  if (!enabled) return undefined;
  if (waypoints.length < 2) return undefined;

  const samplesPerSegment = Math.max(1, Math.min(16, opts.samplesPerSegment ?? 4));
  const tension = Math.max(0, Math.min(1, opts.tension ?? 0.5));

  // Clamp for safety on pathological inputs.
  const maxSegments = 1024;
  const segCount = Math.min(maxSegments, waypoints.length - 1);

  const out: number[] = [];
  out.length = 0;

  const pushPoint = (x: number, y: number) => {
    out.push(x, y);
  };

  // Convert to tile-center coordinates to avoid bias.
  const cx = (t: TileRef) => gm.x(t) + 0.5;
  const cy = (t: TileRef) => gm.y(t) + 0.5;

  // Validate samples stay on water (coarse check) to avoid obvious curve-cutting over land.
  const w = gm.width();
  const h = gm.height();
  const isSampleWater = (x: number, y: number) => {
    const tx = Math.max(0, Math.min(w - 1, Math.floor(x)));
    const ty = Math.max(0, Math.min(h - 1, Math.floor(y)));
    const ref = ty * w + tx;
    if (!gm.isWater(ref)) return false;
    if (noCornerCutting) {
      // If we're close to a corner, be conservative: require the orthogonals to be water as well.
      // This is a heuristic validation; the authoritative path remains tile-valid.
      const fx = x - tx;
      const fy = y - ty;
      const dx = fx < 0.25 ? -1 : fx > 0.75 ? 1 : 0;
      const dy = fy < 0.25 ? -1 : fy > 0.75 ? 1 : 0;
      if (dx !== 0 && dy !== 0) {
        const ox = tx + dx;
        const oy = ty + dy;
        if (ox >= 0 && ox < w && oy >= 0 && oy < h) {
          const orthoA = ty * w + ox;
          const orthoB = oy * w + tx;
          if (!gm.isWater(orthoA) || !gm.isWater(orthoB)) return false;
        }
      }
    }
    return true;
  };

  // Start point.
  pushPoint(cx(waypoints[0]!), cy(waypoints[0]!));

  for (let i = 0; i < segCount; i++) {
    const p0 = waypoints[Math.max(0, i - 1)]!;
    const p1 = waypoints[i]!;
    const p2 = waypoints[i + 1]!;
    const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)]!;

    const x0 = cx(p0);
    const y0 = cy(p0);
    const x1 = cx(p1);
    const y1 = cy(p1);
    const x2 = cx(p2);
    const y2 = cy(p2);
    const x3 = cx(p3);
    const y3 = cy(p3);

    // Skip t=0 (already pushed p1). Include samples up to t<1 and then rely on next segment / final point.
    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const x = catmullRom1D(x0, x1, x2, x3, t, tension);
      const y = catmullRom1D(y0, y1, y2, y3, t, tension);
      if (!isSampleWater(x, y)) return undefined;
      pushPoint(x, y);
    }
  }

  return out;
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

  let windowSize = Math.max(5, opts.windowSize ?? 33);
  // Keep it odd so the "depth field" doesn't get a directional bias from [-k, +k-1] windows.
  if ((windowSize & 1) === 0) windowSize += 1;
  const half = windowSize >> 1;

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
    const x1 = Math.min(w - 1, cx + half);
    const y1 = Math.min(h - 1, cy + half);
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
        if (
          !lineOfSightWater(gm, prev, t, noCornerCutting) ||
          !lineOfSightWater(gm, t, next, noCornerCutting)
        ) {
          continue;
        }
        const dx = (x0 + lx) - cx;
        const dy = (y0 + ly) - cy;
        const d2 = dx * dx + dy * dy;

        if (depth > bestDepth || (depth === bestDepth && d2 < bestDist2)) {
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
  spline?: WaypointSplineOptions,
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

  const splineOpts: WaypointSplineOptions = spline ?? {};
  const splineSamples =
    splineOpts.enabled === false
      ? undefined
      : buildWaypointSplineSamples(gm, waypoints, noCornerCutting, splineOpts);

  // Final: expand the waypoint polyline once into a tile-valid path.
  const out: TileRef[] = [];
  for (let k = 0; k < waypoints.length - 1; k++) {
    expandLine(gm, waypoints[k]!, waypoints[k + 1]!, out);
  }

  return out.length > 0
    ? { waypoints, path: out, spline: splineSamples }
    : { waypoints: [...waterPath], path: [...waterPath] };
}
