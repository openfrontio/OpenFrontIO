import {
  buildNukeTrajectory,
  computeNukeControlPoints,
  computeTrajectoryThresholds,
  type SAMInfo,
} from "../src/client/render/gl/utils/NukeTrajectory";

// A large map height so the parabola arc isn't clamped.
const MAP_H = 1000;

// Helper: build control points for a straight horizontal trajectory.
function horizontalCp(srcX: number, dstX: number) {
  return computeNukeControlPoints(srcX, 500, dstX, 500, MAP_H, true);
}

describe("NukeTrajectory impassable terrain blocking", () => {
  test("tSamIntercept is 1.0 when no SAMs and no blocked terrain", () => {
    const cp = horizontalCp(100, 800);
    const th = computeTrajectoryThresholds(cp, 100, 500, 800, 500, []);
    expect(th.tSamIntercept).toBe(1.0);
  });

  test("tSamIntercept < 1.0 when trajectory crosses impassable terrain", () => {
    const cp = horizontalCp(100, 800);
    // Block tiles at x=400..500 (midway through the arc).
    const isBlocked = (x: number) => x >= 400 && x <= 500;
    const th = computeTrajectoryThresholds(
      cp,
      100,
      500,
      800,
      500,
      [],
      isBlocked,
    );
    expect(th.tSamIntercept).toBeLessThan(1.0);
    // The block is roughly at the midpoint of the curve (t ≈ 0.5).
    expect(th.tSamIntercept).toBeGreaterThan(0.3);
    expect(th.tSamIntercept).toBeLessThan(0.7);
  });

  test("tSamIntercept is 1.0 when blocked terrain is not on the trajectory", () => {
    const cp = horizontalCp(100, 800);
    // Block tiles far away from the trajectory.
    const isBlocked = (x: number) => x >= 0 && x <= 50;
    const th = computeTrajectoryThresholds(
      cp,
      100,
      500,
      800,
      500,
      [],
      isBlocked,
    );
    // The source is at x=100, so blocking x=0..50 shouldn't affect the arc.
    // (The arc starts at x=100 and goes to x=800, it never touches x<100.)
    expect(th.tSamIntercept).toBe(1.0);
  });

  test("blocked terrain takes precedence (min of SAM and blocked)", () => {
    const cp = horizontalCp(100, 800);
    // SAM at x=600 with range covering a wide area.
    const sams: SAMInfo[] = [{ x: 600, y: 500, rangeSq: 200 * 200 }];
    // Block at x=300 (earlier than the SAM at x=600).
    const isBlocked = (x: number) => x >= 300 && x <= 350;
    const th = computeTrajectoryThresholds(
      cp,
      100,
      500,
      800,
      500,
      sams,
      isBlocked,
    );
    // The block at x=300 should be hit first (lower t) than the SAM at x=600.
    expect(th.tSamIntercept).toBeLessThan(0.5);
  });

  test("blocked scan covers the untargetable mid-air zone (not skipped like SAMs)", () => {
    // With a long trajectory, there's an untargetable zone in the middle.
    const cp = horizontalCp(100, 800);
    const th = computeTrajectoryThresholds(cp, 100, 500, 800, 500, []);
    // Verify there IS an untargetable zone.
    expect(th.tUntargetableStart).toBeGreaterThanOrEqual(0);
    expect(th.tUntargetableEnd).toBeGreaterThan(th.tUntargetableStart);

    // Block a tile in the middle of the untargetable zone.
    const blockT = (th.tUntargetableStart + th.tUntargetableEnd) / 2;
    // Sample the Bezier at that t to find the x coordinate.
    const { p0x, p1x, p2x, p3x } = cp;
    const T = 1 - blockT;
    const blockX = Math.floor(
      T * T * T * p0x +
        3 * T * T * blockT * p1x +
        3 * T * blockT * blockT * p2x +
        blockT * blockT * blockT * p3x,
    );
    const isBlocked = (x: number) => x === blockX;

    const th2 = computeTrajectoryThresholds(
      cp,
      100,
      500,
      800,
      500,
      [],
      isBlocked,
    );
    // The blocked tile is in the untargetable zone, but unlike SAMs, the
    // impassable scan should still detect it.
    expect(th2.tSamIntercept).toBeLessThan(1.0);
  });

  test("buildNukeTrajectory passes isBlocked through", () => {
    const data = buildNukeTrajectory(
      100,
      500,
      800,
      500,
      MAP_H,
      true,
      [],
      (x: number) => x >= 400 && x <= 500,
    );
    expect(data.tSamIntercept).toBeLessThan(1.0);
  });

  test("buildNukeTrajectory works without isBlocked (backwards compatible)", () => {
    const data = buildNukeTrajectory(100, 500, 800, 500, MAP_H, true, []);
    expect(data.tSamIntercept).toBe(1.0);
    expect(data.p0x).toBe(100);
    expect(data.p3x).toBe(800);
  });
});
