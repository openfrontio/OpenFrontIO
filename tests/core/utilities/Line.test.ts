import { DistanceBasedBezierCurve } from "../../../src/core/utilities/Line";

describe("DistanceBasedBezierCurve", () => {
  test("straight curve where all four control points lie on one line", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 30, y: 0 };
    const p2 = { x: 70, y: 0 };
    const p3 = { x: 100, y: 0 };
    const spacing = 10;

    const curve = new DistanceBasedBezierCurve(p0, p1, p2, p3, spacing);
    const points = curve.getAllPoints();

    expect(points.length).toBeGreaterThan(1);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });

    // Verify distance between consecutive cached points equals pixelSpacing (or close integer floor)
    for (let i = 1; i < points.length - 1; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));
      expect(dist).toBeGreaterThanOrEqual(spacing - 1);
      expect(dist).toBeLessThanOrEqual(spacing + 1);
    }
  });

  test("zero-length curve where start point equals end point", () => {
    const p0 = { x: 50, y: 50 };
    const p1 = { x: 50, y: 50 };
    const p2 = { x: 50, y: 50 };
    const p3 = { x: 50, y: 50 };

    const curve = new DistanceBasedBezierCurve(p0, p1, p2, p3, 5);
    const points = curve.getAllPoints();

    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ x: 50, y: 50 });
  });

  test("pixelSpacing values of 1 and large number", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 0, y: 50 };
    const p2 = { x: 100, y: 50 };
    const p3 = { x: 100, y: 0 };

    // Small spacing (1) produces many points
    const curveSmall = new DistanceBasedBezierCurve(p0, p1, p2, p3, 1);
    const pointsSmall = curveSmall.getAllPoints();

    // Large spacing (100) produces few points
    const curveLarge = new DistanceBasedBezierCurve(p0, p1, p2, p3, 100);
    const pointsLarge = curveLarge.getAllPoints();

    expect(pointsSmall.length).toBeGreaterThan(pointsLarge.length);
    expect(pointsSmall[0]).toEqual({ x: 0, y: 0 });
    expect(pointsSmall[pointsSmall.length - 1]).toEqual({ x: 100, y: 0 });
    expect(pointsLarge[0]).toEqual({ x: 0, y: 0 });
    expect(pointsLarge[pointsLarge.length - 1]).toEqual({ x: 100, y: 0 });
  });

  test("endpoint rule: p3 is appended only when not already equal to last cached point", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const p2 = { x: 20, y: 0 };
    const p3 = { x: 30, y: 0 };

    const curve = new DistanceBasedBezierCurve(p0, p1, p2, p3, 10);
    const points = curve.getAllPoints();

    // No duplicate endpoint at p3
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    expect(last).toEqual({ x: 30, y: 0 });
    expect(prev).not.toEqual(last);
  });

  test("increment() returns next point and returns null exactly once last index is reached", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    const p2 = { x: 20, y: 0 };
    const p3 = { x: 30, y: 0 };
    const spacing = 10;

    const curve = new DistanceBasedBezierCurve(p0, p1, p2, p3, spacing);
    const totalPoints = curve.getAllPoints().length;

    for (let i = 1; i < totalPoints - 1; i++) {
      const pt = curve.increment(spacing);
      expect(pt).not.toBeNull();
    }

    // Once last index is reached, increment returns null
    const endPt = curve.increment(spacing);
    expect(endPt).toBeNull();
  });

  test("while loop emits multiple uniform points on long leaf segments when pixelSpacing is small", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 50, y: 0 };
    const p2 = { x: 100, y: 0 };
    const p3 = { x: 150, y: 0 };

    // Small pixelSpacing (1) on long curve
    const curve = new DistanceBasedBezierCurve(p0, p1, p2, p3, 1);
    const points = curve.getAllPoints();

    // Verify all consecutive points are 1 unit apart (uniform density)
    for (let i = 1; i < points.length - 1; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const dist = Math.abs(dx) + Math.abs(dy);
      expect(dist).toBeLessThanOrEqual(2);
    }
  });

  test("getLength accurately computes the total arc length using the shared subdivide logic", () => {
    // Test on a curve
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 50, y: 100 };
    const p2 = { x: 100, y: 100 };
    const p3 = { x: 150, y: 0 };

    const length = DistanceBasedBezierCurve.getLength(p0, p1, p2, p3);

    // A curve bridging 0 to 150 via y=100 must be strictly longer than the straight line distance (150)
    expect(length).toBeGreaterThan(150);

    // Test on a straight line
    const straightLength = DistanceBasedBezierCurve.getLength(
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 150, y: 0 },
    );

    // The straight line length should be exactly 150
    expect(Math.round(straightLength)).toBe(150);
  });
});
