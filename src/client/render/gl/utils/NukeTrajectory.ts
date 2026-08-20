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
const THRESHOLD_SAMPLES = 32;

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
  r: number;
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

/**
 * Minimum squared distance from a point (px, py) to line segment (x0, y0) -> (x1, y1).
 * Prevents skipping SAM circles on tangent crossings between discrete sample steps.
 */
function segmentDistSq(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  px: number,
  py: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dxP = px - x0;
  const dyP = py - y0;
  const dSrcSq = dxP * dxP + dyP * dyP;
  const dot = dxP * dx + dyP * dy;
  
  if (dot <= 0) return dSrcSq;
  
  const l2 = dx * dx + dy * dy;
  if (dot >= l2) return dSrcSq + l2 - 2 * dot;
  
  return dSrcSq - (dot * dot) / l2;
}

/** Binary-search for the exact parameter t where the trajectory enters/exits rangeSq. */
function refineCrossing(
  polyAx: number,
  polyBx: number,
  polyCx: number,
  polyDx: number,
  polyAy: number,
  polyBy: number,
  polyCy: number,
  polyDy: number,
  cx: number,
  cy: number,
  rangeSq: number,
  tLo: number,
  tHi: number,
  exitingRange: boolean,
): number {
  let cachedLoX =
    (((polyAx * tLo + polyBx) * tLo + polyCx) * tLo + polyDx + 0.5) | 0;
  let cachedLoY =
    (((polyAy * tLo + polyBy) * tLo + polyCy) * tLo + polyDy + 0.5) | 0;

  for (let i = 0; i < 10; i++) {
    const tMid = (tLo + tHi) * 0.5;

    const xMid =
      (((polyAx * tMid + polyBx) * tMid + polyCx) * tMid + polyDx + 0.5) | 0;
    const yMid =
      (((polyAy * tMid + polyBy) * tMid + polyCy) * tMid + polyDy + 0.5) | 0;

    const leftInside =
      segmentDistSq(cachedLoX, cachedLoY, xMid, yMid, cx, cy) <= rangeSq;
    if (exitingRange ? !leftInside : leftInside) {
      tHi = tMid;
    } else {
      tLo = tMid;
      cachedLoX = xMid;
      cachedLoY = yMid;
    }
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
  let tSamPaddedIntercept = 1.0;

  const dt = 1.0 / THRESHOLD_SAMPLES;

  const polyCx = 3 * (cp.p1x - cp.p0x);
  const polyBx = 3 * (cp.p2x - 2 * cp.p1x + cp.p0x);
  const polyAx = dstX - 3 * cp.p2x + 3 * cp.p1x - cp.p0x;
  const polyDx = cp.p0x;

  const polyCy = 3 * (cp.p1y - cp.p0y);
  const polyBy = 3 * (cp.p2y - 2 * cp.p1y + cp.p0y);
  const polyAy = dstY - 3 * cp.p2y + 3 * cp.p1y - cp.p0y;
  const polyDy = cp.p0y;

  const srcDstDx = dstX - srcX;
  const srcDstDy = dstY - srcY;
  const srcDstDistSq = srcDstDx * srcDstDx + srcDstDy * srcDstDy;
  
  const hasUntargetable = srcDstDistSq > 4 * TARGETABLE_RANGE_SQ;
  const samLen = sams.length;

  let prevX = (cp.p0x + 0.5) | 0;
  let prevY = (cp.p0y + 0.5) | 0;

  for (let i = 1; i <= THRESHOLD_SAMPLES; i++) {
    const t = i * dt;
    const tPrev = t - dt;
    const x = (((polyAx * t + polyBx) * t + polyCx) * t + polyDx + 0.5) | 0;
    const y = (((polyAy * t + polyBy) * t + polyCy) * t + polyDy + 0.5) | 0;

    let isUntargetableZone = false;

    if (hasUntargetable) {
      if (tUntargetableStart < 0) {
        // Looking for first point outside source range
        const dxSrc = x - srcX;
        const dySrc = y - srcY;
        if (dxSrc * dxSrc + dySrc * dySrc > TARGETABLE_RANGE_SQ) {
          const dxDst = x - dstX;
          const dyDst = y - dstY;
          if (dxDst * dxDst + dyDst * dyDst >= TARGETABLE_RANGE_SQ) {
            tUntargetableStart = refineCrossing(
              polyAx, polyBx, polyCx, polyDx, polyAy, polyBy, polyCy, polyDy,
              srcX, srcY, TARGETABLE_RANGE_SQ, tPrev, t, true
            );
            isUntargetableZone = true;
          }
        }
      } else if (tUntargetableEnd < 0) {
        // Looking for first point inside target range
        const dxDst = x - dstX;
        const dyDst = y - dstY;
        if (dxDst * dxDst + dyDst * dyDst < TARGETABLE_RANGE_SQ) {
          tUntargetableEnd = refineCrossing(
            polyAx, polyBx, polyCx, polyDx, polyAy, polyBy, polyCy, polyDy,
            dstX, dstY, TARGETABLE_RANGE_SQ, tPrev, t, false
          );
        } else {
          isUntargetableZone = true;
        }
      }
    }

    // Check exact boundary when crossing into the targetable terminal phase
    if (
      tUntargetableEnd >= 0 &&
      tPrev < tUntargetableEnd &&
      t >= tUntargetableEnd &&
      samLen > 0
    ) {
      const xe =
        (((polyAx * tUntargetableEnd + polyBx) * tUntargetableEnd + polyCx) *
          tUntargetableEnd +
          polyDx +
          0.5) |
        0;
      const ye =
        (((polyAy * tUntargetableEnd + polyBy) * tUntargetableEnd + polyCy) *
          tUntargetableEnd +
          polyDy +
          0.5) |
        0;
      for (let s = 0; s < samLen; s++) {
        const sam = sams[s];
        const dx = xe - sam.x;
        const dy = ye - sam.y;
        if (dx * dx + dy * dy <= sam.r * sam.r) {
          tSamIntercept = tUntargetableEnd;
          break;
        }
      }
      if (tSamIntercept < 1.0) break;
    }

    if (!isUntargetableZone && samLen > 0) {
      const segDx = x - prevX;
      const segDy = y - prevY;
      const l2 = segDx * segDx + segDy * segDy;
      const invL2 = l2 === 0 ? 0 : 1.0 / l2;

      for (let s = 0; s < samLen; s++) {
        const sam = sams[s];

        // Fast proximity rejection
        const dxSam = sam.x - prevX;
        const dySam = sam.y - prevY;
        const dSrcSq = dxSam * dxSam + dySam * dySam;
        if (dSrcSq > 62500) {
          continue;
        }

        let dSq: number;
        const dot = dxSam * segDx + dySam * segDy;
        
        if (dot <= 0) {
          dSq = dSrcSq;
        } else if (dot >= l2) {
          dSq = dSrcSq + l2 - 2 * dot;
        } else {
          dSq = dSrcSq - dot * dot * invL2;
        }

        const rangeSq = sam.r * sam.r;
        if (dSq <= rangeSq) {
          const lo =
            tUntargetableEnd >= 0 && tPrev < tUntargetableEnd
              ? tUntargetableEnd
              : tPrev;
          // Direct hit: exact boundary intersection (r)
          tSamIntercept = refineCrossing(
            polyAx, polyBx, polyCx, polyDx, polyAy, polyBy, polyCy, polyDy,
            sam.x, sam.y, rangeSq, lo, t, false
          );
          break;
        } else {
          // Glancing blow: record padded intercept (r + 0.5) as fallback for edge-case skimming
          const paddedRangeSq = (sam.r + 0.5) * (sam.r + 0.5);
          if (dSq <= paddedRangeSq) {
            if (tSamPaddedIntercept === 1.0) {
              const lo =
                tUntargetableEnd >= 0 && tPrev < tUntargetableEnd
                  ? tUntargetableEnd
                  : tPrev;
              tSamPaddedIntercept = refineCrossing(
                polyAx, polyBx, polyCx, polyDx, polyAy, polyBy, polyCy, polyDy,
                sam.x, sam.y, paddedRangeSq, lo, t, false
              );
            }
          }
        }
      }
      if (tSamIntercept < 1.0) break;
    }

    prevX = x;
    prevY = y;
  }

  // Fallback to padded intercept ONLY if no direct hit occurred along the trajectory
  if (tSamIntercept === 1.0 && tSamPaddedIntercept < 1.0) {
    tSamIntercept = tSamPaddedIntercept;
  }

  return { tUntargetableStart, tUntargetableEnd, tSamIntercept };
}

/**
 * Build complete NukeTrajectoryData from source/target positions.
 * Uses smooth render control points for continuous 60fps GPU mouse tracking,
 * combined with discrete tile control points for Core simulation threshold accuracy.
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
  const cpRender = computeNukeControlPoints(
    srcX,
    srcY,
    dstX,
    dstY,
    mapH,
    directionUp,
  );

  const targetX = Math.round(dstX);
  const targetY = Math.round(dstY);

  const th = computeTrajectoryThresholds(
    cpRender,
    srcX,
    srcY,
    targetX,
    targetY,
    sams,
  );
  return { ...cpRender, ...th };
}
