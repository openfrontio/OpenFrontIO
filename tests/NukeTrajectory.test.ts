import {
  buildNukeTrajectory,
  computeNukeControlPoints,
  computeTrajectoryThresholds,
} from "../src/client/render/gl/utils/NukeTrajectory";

// A large map height so the parabola arc isn't clamped.
const MAP_H = 1000;

// Helper: build control points for a straight horizontal trajectory.
function horizontalCp(srcX: number, dstX: number) {
  return computeNukeControlPoints(srcX, 500, dstX, 500, MAP_H, true);
}

describe("NukeTrajectory thresholds", () => {
  test("tSamIntercept is 1.0 when no SAMs", () => {
    const cp = horizontalCp(100, 800);
    const th = computeTrajectoryThresholds(cp, 100, 500, 800, 500, []);
    expect(th.tSamIntercept).toBe(1.0);
  });

  test("long trajectory has an untargetable mid-air zone", () => {
    const cp = horizontalCp(100, 800);
    const th = computeTrajectoryThresholds(cp, 100, 500, 800, 500, []);
    expect(th.tUntargetableStart).toBeGreaterThanOrEqual(0);
    expect(th.tUntargetableEnd).toBeGreaterThan(th.tUntargetableStart);
  });

  test("buildNukeTrajectory combines control points and thresholds", () => {
    const data = buildNukeTrajectory(100, 500, 800, 500, MAP_H, true, []);
    expect(data.tSamIntercept).toBe(1.0);
    expect(data.p0x).toBe(100);
    expect(data.p3x).toBe(800);
  });

  test("intercepts nuke when SAM covers tUntargetableEnd but excludes next sample", () => {
    const cp = horizontalCp(100, 800);
    const thBase = computeTrajectoryThresholds(cp, 100, 500, 800, 500, []);
    const t = thBase.tUntargetableEnd,
      T = 1 - t;
    const x =
      T * (T * (T * cp.p0x + 3 * t * cp.p1x) + 3 * t * t * cp.p2x) +
      t * t * t * cp.p3x;
    const y =
      T * (T * (T * cp.p0y + 3 * t * cp.p1y) + 3 * t * t * cp.p2y) +
      t * t * t * cp.p3y;
    const th = computeTrajectoryThresholds(cp, 100, 500, 800, 500, [
      { x, y, r: 5 },
    ]);
    expect(th.tSamIntercept).toBe(t);
  });

  test("detects SAM intercept along trajectory", () => {
    const cp = horizontalCp(100, 800);
    const sam = { x: 750, y: 500, r: 50 };
    const th = computeTrajectoryThresholds(cp, 100, 500, 800, 500, [sam]);
    expect(th.tSamIntercept).toBeLessThan(1.0);
  });

  test("validates 32 samples with 0.5 offset across all tangent cells and safe cells", () => {
    const srcX = 1249;
    const srcY = 108;
    const samX = 984;
    const samY = 380;
    const r = 150 - 480 / 11 + 0.5; // Level 6 SAM + 0.5 buffer
    const sams = [{ x: samX, y: samY, r }];

    // Tangent cells crossing into SAM range
    const tangentCells = [
      { dstX: 859, dstY: 397 },
      { dstX: 864, dstY: 385 },
      { dstX: 860, dstY: 395 },
      { dstX: 862, dstY: 390 },
      { dstX: 863, dstY: 387 },
    ];

    for (const cell of tangentCells) {
      const traj = buildNukeTrajectory(
        srcX,
        srcY,
        cell.dstX,
        cell.dstY,
        1000,
        true,
        sams,
      );
      expect(traj.tSamIntercept).toBeLessThan(1.0);
    }

    // Safe cell passing outside SAM range
    const safeTraj = buildNukeTrajectory(
      srcX,
      srcY,
      865,
      380,
      1000,
      true,
      sams,
    );
    expect(safeTraj.tSamIntercept).toBe(1.0);
  });
});
