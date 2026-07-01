/**
 * Nuke trajectory computation — Bezier control points and color thresholds.
 *
 * Matches upstream PathFinder.Parabola.ts + Line.ts math exactly.
 * Pure functions, no game dependencies.
 */

import type { NukeTrajectoryData } from "../../types";

// Upstream constants
const PARABOLA_MIN_HEIGHT = 50;
const TARGETABLE_RANGE = 150;
const TARGETABLE_RANGE_SQ = TARGETABLE_RANGE * TARGETABLE_RANGE;
const THRESHOLD_SAMPLES = 64;

// SAM range formula: 150 - 480 / (level + 5)
const MAX_SAM_RANGE = 150;
const SAM_RANGE_DIVISOR = 480;
const SAM_RANGE_OFFSET = 5;

export function samRange(level: number): number {
  return MAX_SAM_RANGE - SAM_RANGE_DIVISOR / (level + SAM_RANGE_OFFSET);
}

export interface SAMInfo {
  x: number;
  y: number;
  rangeSq: number;
}

/** Cubic Bezier evaluation at parameter t. */
function bezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const T = 1 - t;
  return (
    T * T * T * p0 + 3 * T * T * t * p1 + 3 * T * t * t * p2 + t * t * t * p3
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Compute Bezier control points matching upstream parabola pathfinder.
 *
 * The curve bows perpendicular to the src→dst line. `directionUp` controls
 * which side (in Y) the arc bows toward (upstream convention: true = -Y).
 */
export function computeNukeControlPoints(
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  mapH: number,
  directionUp: boolean,
): {
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  p3x: number;
  p3y: number;
} {
  const dx = dstX - srcX;
  const dy = dstY - srcY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxHeight = Math.max(dist / 3, PARABOLA_MIN_HEIGHT);
  const hm = directionUp ? -1 : 1;

  return {
    p0x: srcX,
    p0y: srcY,
    p1x: srcX + dx / 4,
    p1y: clamp(srcY + dy / 4 + hm * maxHeight, 0, mapH - 1),
    p2x: srcX + (dx * 3) / 4,
    p2y: clamp(srcY + (dy * 3) / 4 + hm * maxHeight, 0, mapH - 1),
    p3x: dstX,
    p3y: dstY,
  };
}

/** Binary-search for the exact t where distSq to (cx,cy) crosses rangeSq. */
function refineCrossing(
  cp: {
    p0x: number;
    p0y: number;
    p1x: number;
    p1y: number;
    p2x: number;
    p2y: number;
    p3x: number;
    p3y: number;
  },
  cx: number,
  cy: number,
  rangeSq: number,
  tLo: number,
  tHi: number,
  exitingRange: boolean,
): number {
  for (let i = 0; i < 10; i++) {
    const tMid = (tLo + tHi) * 0.5;
    const x = bezier(tMid, cp.p0x, cp.p1x, cp.p2x, cp.p3x);
    const y = bezier(tMid, cp.p0y, cp.p1y, cp.p2y, cp.p3y);
    const inside = distSq(x, y, cx, cy) <= rangeSq;
    if (exitingRange ? inside : !inside) tLo = tMid;
    else tHi = tMid;
  }
  return (tLo + tHi) * 0.5;
}

/**
 * Sample the Bezier curve at regular t intervals and find color threshold
 * t-values for untargetable zones, SAM intercept, and impassable terrain.
 *
 * Uses binary search refinement for sub-sample precision so that zone
 * boundary markers don't jiggle when the cursor moves.
 *
 * @param isBlocked Optional callback: given a continuous (x, y) point on the
 *                  Bezier, returns true if that point falls on impassable
 *                  terrain. The scan covers the ENTIRE curve (including the
 *                  untargetable mid-air zone), because impassable terrain
 *                  blocks the nuke regardless of targetability. When a
 *                  blocked point is found, its t-value is merged into
 *                  `tSamIntercept` (via min) so the existing red-line + red-X
 *                  machinery renders the trajectory as blocked.
 */
export function computeTrajectoryThresholds(
  cp: {
    p0x: number;
    p0y: number;
    p1x: number;
    p1y: number;
    p2x: number;
    p2y: number;
    p3x: number;
    p3y: number;
  },
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  sams: readonly SAMInfo[],
  isBlocked?: (x: number, y: number) => boolean,
): {
  tUntargetableStart: number;
  tUntargetableEnd: number;
  tSamIntercept: number;
} {
  let tUntargetableStart = -1;
  let tUntargetableEnd = -1;
  let tSamIntercept = 1.0;
  let tBlocked = 1.0;

  const dt = 1.0 / THRESHOLD_SAMPLES;

  // Pass 1: find untargetable zone boundaries
  for (let i = 1; i <= THRESHOLD_SAMPLES; i++) {
    const t = i * dt;
    const x = bezier(t, cp.p0x, cp.p1x, cp.p2x, cp.p3x);
    const y = bezier(t, cp.p0y, cp.p1y, cp.p2y, cp.p3y);

    if (tUntargetableStart < 0) {
      // Looking for first point outside source range
      if (distSq(x, y, srcX, srcY) > TARGETABLE_RANGE_SQ) {
        if (distSq(x, y, dstX, dstY) < TARGETABLE_RANGE_SQ) {
          // Overlapping source & target range — no untargetable zone
          break;
        }
        tUntargetableStart = refineCrossing(
          cp,
          srcX,
          srcY,
          TARGETABLE_RANGE_SQ,
          t - dt,
          t,
          true,
        );
      }
    } else {
      // Looking for first point inside target range
      if (distSq(x, y, dstX, dstY) < TARGETABLE_RANGE_SQ) {
        tUntargetableEnd = refineCrossing(
          cp,
          dstX,
          dstY,
          TARGETABLE_RANGE_SQ,
          t - dt,
          t,
          false,
        );
        break;
      }
    }
  }

  // Pass 2: find SAM intercept (skip untargetable zone)
  if (sams.length > 0) {
    for (let i = 1; i <= THRESHOLD_SAMPLES; i++) {
      const t = i * dt;

      // Skip untargetable segment
      if (
        tUntargetableStart >= 0 &&
        t >= tUntargetableStart &&
        t <= tUntargetableEnd
      ) {
        continue;
      }

      const x = bezier(t, cp.p0x, cp.p1x, cp.p2x, cp.p3x);
      const y = bezier(t, cp.p0y, cp.p1y, cp.p2y, cp.p3y);

      for (const sam of sams) {
        if (distSq(x, y, sam.x, sam.y) <= sam.rangeSq) {
          tSamIntercept = refineCrossing(
            cp,
            sam.x,
            sam.y,
            sam.rangeSq,
            t - dt,
            t,
            false,
          );
          break;
        }
      }
      if (tSamIntercept < 1.0) break;
    }
  }

  // Pass 3: find impassable terrain intercept (scan the ENTIRE curve —
  // impassable terrain blocks the nuke regardless of targetability, so
  // unlike SAMs we do NOT skip the untargetable mid-air zone).
  if (isBlocked) {
    for (let i = 1; i <= THRESHOLD_SAMPLES; i++) {
      const t = i * dt;
      const x = bezier(t, cp.p0x, cp.p1x, cp.p2x, cp.p3x);
      const y = bezier(t, cp.p0y, cp.p1y, cp.p2y, cp.p3y);
      // Mirror the simulation's tile-sampling: floor to integer tile coords.
      if (isBlocked(Math.floor(x), Math.floor(y))) {
        tBlocked = refineBlockedCrossing(cp, isBlocked, t - dt, t);
        break;
      }
    }
    // Merge: the earlier of SAM intercept and impassable block determines
    // where the trajectory turns red + shows the X.
    tSamIntercept = Math.min(tSamIntercept, tBlocked);
  }

  return { tUntargetableStart, tUntargetableEnd, tSamIntercept };
}

/**
 * Binary-search for the exact t where the curve first enters a blocked tile.
 * Unlike refineCrossing (which uses a radial distance test), this tests
 * isBlocked on the floored integer tile at each subdivision point.
 */
function refineBlockedCrossing(
  cp: {
    p0x: number;
    p0y: number;
    p1x: number;
    p1y: number;
    p2x: number;
    p2y: number;
    p3x: number;
    p3y: number;
  },
  isBlocked: (x: number, y: number) => boolean,
  tLo: number,
  tHi: number,
): number {
  for (let i = 0; i < 10; i++) {
    const tMid = (tLo + tHi) * 0.5;
    const x = Math.floor(bezier(tMid, cp.p0x, cp.p1x, cp.p2x, cp.p3x));
    const y = Math.floor(bezier(tMid, cp.p0y, cp.p1y, cp.p2y, cp.p3y));
    if (isBlocked(x, y)) tHi = tMid;
    else tLo = tMid;
  }
  return (tLo + tHi) * 0.5;
}

/**
 * Build complete NukeTrajectoryData from source/target positions.
 * Convenience function combining control point + threshold computation.
 *
 * @param isBlocked Optional callback: returns true if a floored (x, y) point
 *                  on the Bezier is impassable terrain. When provided, the
 *                  trajectory turns red and shows the red X at the first
 *                  impassable tile (merged with any SAM intercept).
 */
export function buildNukeTrajectory(
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  mapH: number,
  directionUp: boolean,
  sams: readonly SAMInfo[],
  isBlocked?: (x: number, y: number) => boolean,
): NukeTrajectoryData {
  const cp = computeNukeControlPoints(
    srcX,
    srcY,
    dstX,
    dstY,
    mapH,
    directionUp,
  );
  const th = computeTrajectoryThresholds(
    cp,
    srcX,
    srcY,
    dstX,
    dstY,
    sams,
    isBlocked,
  );
  return { ...cp, ...th };
}
