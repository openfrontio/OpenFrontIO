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
      { x, y, rangeSq: 25 },
    ]);
    expect(th.tSamIntercept).toBe(t);
  });
});
