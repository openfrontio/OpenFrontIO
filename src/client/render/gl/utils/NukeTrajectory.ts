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
 * t-values for untargetable zones and SAM intercept.
 *
 * Uses binary search refinement for sub-sample precision so that zone
 * boundary markers don't jiggle when the cursor moves.
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
): {
  tUntargetableStart: number;
  tUntargetableEnd: number;
  tSamIntercept: number;
} {
  let tUntargetableStart = -1;
  let tUntargetableEnd = -1;
  let tSamIntercept = 1.0;

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

  return { tUntargetableStart, tUntargetableEnd, tSamIntercept };
}

/**
 * Build complete NukeTrajectoryData from source/target positions.
 * Convenience function combining control point + threshold computation.
 */
export function buildNukeTrajectory(
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  mapH: number,
  directionUp: boolean,
  sams: readonly SAMInfo[],
): NukeTrajectoryData {
  const cp = computeNukeControlPoints(
    srcX,
    srcY,
    dstX,
    dstY,
    mapH,
    directionUp,
  );
  const th = computeTrajectoryThresholds(cp, srcX, srcY, dstX, dstY, sams);
  return { ...cp, ...th };
}
