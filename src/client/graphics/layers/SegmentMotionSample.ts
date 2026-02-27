import { TileRef } from "../../../core/game/GameMap";
import type { GameView } from "../../../core/game/GameView";

export type GridSegmentMotionPlanView = {
  planId: number;
  startTick: number;
  ticksPerStep: number;
  points: Uint32Array;
  segmentSteps: Uint32Array;
  segCumSteps: Uint32Array;
};

export type SampledMotionPosition = {
  x: number;
  y: number;
  isComplete: boolean;
  tile0: TileRef;
  tile1: TileRef;
};

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

export function sampleGridSegmentPlan(
  game: GameView,
  plan: GridSegmentMotionPlanView,
  tickFloat: number,
): SampledMotionPosition | null {
  const points = plan.points;
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1 || plan.segmentSteps.length === 0) {
    const t = points[0] as TileRef;
    return { x: game.x(t), y: game.y(t), isComplete: true, tile0: t, tile1: t };
  }

  const ticksPerStep = Math.max(1, plan.ticksPerStep);
  const stepFloat = (tickFloat - plan.startTick) / ticksPerStep;

  const segCum = plan.segCumSteps;
  const totalSteps = segCum.length === 0 ? 0 : segCum[segCum.length - 1] >>> 0;
  if (totalSteps <= 0) {
    const t = points[points.length - 1] as TileRef;
    return { x: game.x(t), y: game.y(t), isComplete: true, tile0: t, tile1: t };
  }

  if (stepFloat <= 0) {
    const t = points[0] as TileRef;
    const t1 = points[1] as TileRef;
    return {
      x: game.x(t),
      y: game.y(t),
      isComplete: false,
      tile0: t,
      tile1: t1,
    };
  }
  if (stepFloat >= totalSteps) {
    const t = points[points.length - 1] as TileRef;
    return { x: game.x(t), y: game.y(t), isComplete: true, tile0: t, tile1: t };
  }

  // Find the segment containing stepFloat.
  let seg = 0;
  let lo = 0;
  let hi = plan.segmentSteps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = segCum[mid] >>> 0;
    const end = segCum[mid + 1] >>> 0;
    if (stepFloat < start) {
      hi = mid - 1;
    } else if (stepFloat >= end) {
      lo = mid + 1;
    } else {
      seg = mid;
      break;
    }
  }

  const segStart = segCum[seg] >>> 0;
  const steps = Math.max(1, plan.segmentSteps[seg] >>> 0);
  const u = clamp01((stepFloat - segStart) / steps);

  const tile0 = points[seg] as TileRef;
  const tile1 = points[seg + 1] as TileRef;
  const x0 = game.x(tile0);
  const y0 = game.y(tile0);
  const x1 = game.x(tile1);
  const y1 = game.y(tile1);

  return {
    x: x0 + (x1 - x0) * u,
    y: y0 + (y1 - y0) * u,
    isComplete: false,
    tile0,
    tile1,
  };
}
