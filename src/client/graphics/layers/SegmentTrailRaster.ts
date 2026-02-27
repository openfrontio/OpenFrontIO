import { TileRef } from "../../../core/game/GameMap";

type TrailGameView = {
  x(ref: TileRef): number;
  y(ref: TileRef): number;
};

export type SegmentTrailPlanView = {
  startTick: number;
  ticksPerStep: number;
  points: Uint32Array;
  segmentSteps: Uint32Array;
  segCumSteps: Uint32Array;
};

export function totalTrailSteps(plan: {
  segCumSteps: Uint32Array;
}): number {
  return plan.segCumSteps.length === 0
    ? 0
    : plan.segCumSteps[plan.segCumSteps.length - 1] >>> 0;
}

export function stepAtTick(
  plan: SegmentTrailPlanView,
  tick: number,
): number {
  const total = totalTrailSteps(plan);
  if (total <= 0) {
    return 0;
  }
  const dt = tick - plan.startTick;
  if (dt <= 0) {
    return 0;
  }
  const ticksPerStep = Math.max(1, plan.ticksPerStep);
  const step = Math.floor(dt / ticksPerStep);
  return Math.max(0, Math.min(total, step));
}

export function locateSegment(
  segCumSteps: Uint32Array,
  segmentCount: number,
  step: number,
): number {
  if (segmentCount <= 0) {
    return 0;
  }
  const total =
    segCumSteps.length === 0
      ? 0
      : segCumSteps[segCumSteps.length - 1] >>> 0;
  if (total <= 0) {
    return 0;
  }
  if (step >= total) {
    return Math.max(0, segmentCount - 1);
  }

  let lo = 0;
  let hi = segmentCount - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = segCumSteps[mid] >>> 0;
    const end = segCumSteps[mid + 1] >>> 0;
    if (step < start) {
      hi = mid - 1;
    } else if (step >= end) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(segmentCount - 1, lo));
}

export function positionAtStep(
  game: TrailGameView,
  plan: SegmentTrailPlanView,
  step: number,
): { x: number; y: number } | null {
  const points = plan.points;
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1 || plan.segmentSteps.length === 0) {
    const t = points[points.length - 1] as TileRef;
    return { x: game.x(t), y: game.y(t) };
  }

  const total = totalTrailSteps(plan);
  const idx = Math.max(0, Math.min(total, step));
  if (idx >= total) {
    const t = points[points.length - 1] as TileRef;
    return { x: game.x(t), y: game.y(t) };
  }

  const segmentCount = plan.segmentSteps.length;
  const seg = locateSegment(plan.segCumSteps, segmentCount, idx);
  const segStart = plan.segCumSteps[seg] >>> 0;
  const steps = Math.max(1, plan.segmentSteps[seg] >>> 0);

  const p0 = points[seg] as TileRef;
  const p1 = points[Math.min(points.length - 1, seg + 1)] as TileRef;
  const x0 = game.x(p0);
  const y0 = game.y(p0);
  const x1 = game.x(p1);
  const y1 = game.y(p1);
  const local = idx - segStart;

  return {
    x: x0 + ((x1 - x0) * local) / steps,
    y: y0 + ((y1 - y0) * local) / steps,
  };
}

export function strokeStepInterval(
  ctx: CanvasRenderingContext2D,
  game: TrailGameView,
  plan: SegmentTrailPlanView,
  fromStep: number,
  toStep: number,
): boolean {
  const total = totalTrailSteps(plan);
  if (total <= 0) {
    return false;
  }

  const from = Math.max(0, Math.min(total, fromStep));
  const to = Math.max(0, Math.min(total, toStep));
  if (to <= from) {
    return false;
  }

  const start = positionAtStep(game, plan, from);
  const end = positionAtStep(game, plan, to);
  if (!start || !end) {
    return false;
  }

  const segmentCount = plan.segmentSteps.length;
  if (segmentCount === 0) {
    return false;
  }

  const fromSeg = locateSegment(plan.segCumSteps, segmentCount, from);
  const toSeg = locateSegment(plan.segCumSteps, segmentCount, to);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);

  if (fromSeg === toSeg) {
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    return true;
  }

  const fromBoundaryRef = plan.points[Math.min(plan.points.length - 1, fromSeg + 1)] as TileRef;
  ctx.lineTo(game.x(fromBoundaryRef), game.y(fromBoundaryRef));

  for (let seg = fromSeg + 1; seg < toSeg; seg++) {
    const boundaryRef = plan.points[Math.min(plan.points.length - 1, seg + 1)] as TileRef;
    ctx.lineTo(game.x(boundaryRef), game.y(boundaryRef));
  }

  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  return true;
}
