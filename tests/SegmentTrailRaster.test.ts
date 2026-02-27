import { describe, expect, it } from "vitest";
import {
  locateSegment,
  positionAtStep,
  stepAtTick,
  strokeStepInterval,
} from "../src/client/graphics/layers/SegmentTrailRaster";

function makeGame() {
  return {
    x(ref: number): number {
      return ref % 10;
    },
    y(ref: number): number {
      return Math.floor(ref / 10);
    },
  };
}

function makePlan() {
  return {
    startTick: 10,
    ticksPerStep: 2,
    points: Uint32Array.from([0, 3, 33]), // (0,0)->(3,0)->(3,3)
    segmentSteps: Uint32Array.from([3, 3]),
    segCumSteps: Uint32Array.from([0, 3, 6]),
  };
}

function makeMockCtx() {
  const ops: Array<{ op: string; x?: number; y?: number }> = [];
  const ctx = {
    beginPath() {
      ops.push({ op: "beginPath" });
    },
    moveTo(x: number, y: number) {
      ops.push({ op: "moveTo", x, y });
    },
    lineTo(x: number, y: number) {
      ops.push({ op: "lineTo", x, y });
    },
    stroke() {
      ops.push({ op: "stroke" });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

describe("SegmentTrailRaster", () => {
  it("stepAtTick clamps before start and after end", () => {
    const plan = makePlan();
    expect(stepAtTick(plan, 8)).toBe(0);
    expect(stepAtTick(plan, 10)).toBe(0);
    expect(stepAtTick(plan, 12)).toBe(1);
    expect(stepAtTick(plan, 100)).toBe(6);
  });

  it("locateSegment handles boundaries with end-exclusive segments", () => {
    const plan = makePlan();
    expect(locateSegment(plan.segCumSteps, 2, 0)).toBe(0);
    expect(locateSegment(plan.segCumSteps, 2, 2)).toBe(0);
    expect(locateSegment(plan.segCumSteps, 2, 3)).toBe(1);
    expect(locateSegment(plan.segCumSteps, 2, 6)).toBe(1);
  });

  it("positionAtStep matches expected piecewise interpolation", () => {
    const plan = makePlan();
    const game = makeGame();
    expect(positionAtStep(game, plan, 2)).toEqual({ x: 2, y: 0 });
    expect(positionAtStep(game, plan, 4)).toEqual({ x: 3, y: 1 });
    expect(positionAtStep(game, plan, 6)).toEqual({ x: 3, y: 3 });
  });

  it("strokeStepInterval draws same-segment interval including first step", () => {
    const { ctx, ops } = makeMockCtx();
    const plan = makePlan();
    const game = makeGame();
    const drew = strokeStepInterval(ctx, game, plan, 0, 1);
    expect(drew).toBe(true);
    expect(ops).toEqual([
      { op: "beginPath" },
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 1, y: 0 },
      { op: "stroke" },
    ]);
  });

  it("strokeStepInterval crosses corners without skipping boundaries", () => {
    const { ctx, ops } = makeMockCtx();
    const plan = makePlan();
    const game = makeGame();
    const drew = strokeStepInterval(ctx, game, plan, 2, 5);
    expect(drew).toBe(true);
    expect(ops).toEqual([
      { op: "beginPath" },
      { op: "moveTo", x: 2, y: 0 },
      { op: "lineTo", x: 3, y: 0 },
      { op: "lineTo", x: 3, y: 2 },
      { op: "stroke" },
    ]);
  });

  it("strokeStepInterval no-ops for empty deltas", () => {
    const { ctx, ops } = makeMockCtx();
    const plan = makePlan();
    const game = makeGame();
    expect(strokeStepInterval(ctx, game, plan, 4, 4)).toBe(false);
    expect(ops).toEqual([]);
  });

  it("supports replan-style epoch replay by drawing multiple intervals", () => {
    const { ctx, ops } = makeMockCtx();
    const game = makeGame();
    const epochA = {
      startTick: 0,
      ticksPerStep: 1,
      points: Uint32Array.from([0, 3]),
      segmentSteps: Uint32Array.from([3]),
      segCumSteps: Uint32Array.from([0, 3]),
    };
    const epochB = {
      startTick: 3,
      ticksPerStep: 1,
      points: Uint32Array.from([3, 33]),
      segmentSteps: Uint32Array.from([3]),
      segCumSteps: Uint32Array.from([0, 3]),
    };

    expect(strokeStepInterval(ctx, game, epochA, 0, 3)).toBe(true);
    expect(strokeStepInterval(ctx, game, epochB, 0, 2)).toBe(true);

    expect(ops).toEqual([
      { op: "beginPath" },
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 3, y: 0 },
      { op: "stroke" },
      { op: "beginPath" },
      { op: "moveTo", x: 3, y: 0 },
      { op: "lineTo", x: 3, y: 2 },
      { op: "stroke" },
    ]);
  });
});
