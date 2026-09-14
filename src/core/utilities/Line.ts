type Point = { x: number; y: number };

/**
 *  Precomputes regular curve step points along a cubic Bezier curve.
 */
export class DistanceBasedBezierCurve {
  private static readonly SUB_SCALE = 256;

  private cachedPoints: Point[] = [];
  private currentIndex: number = 0;
  private pixelSpacingScaled: number = 1;
  private accumulatedDistanceScaled: number = 0;

  constructor(
    private p0: Point,
    private p1: Point,
    private p2: Point,
    private p3: Point,
    distanceIncrement: number,
  ) {
    this.computeAllPoints(distanceIncrement);
  }

  /**
   * Statically compute the full length of a bezier curve without allocating any points.
   */
  static getLength(p0: Point, p1: Point, p2: Point, p3: Point): number {
    const scale = 256;
    const p0x = Math.round(p0.x) * scale;
    const p0y = Math.round(p0.y) * scale;
    const p3x = Math.round(p3.x) * scale;
    const p3y = Math.round(p3.y) * scale;

    const st = { lastX: p0x, lastY: p0y, accumDist: 0 };

    DistanceBasedBezierCurve.sharedSubdivide(
      p0x,
      p0y,
      Math.round(p1.x) * scale,
      Math.round(p1.y) * scale,
      Math.round(p2.x) * scale,
      Math.round(p2.y) * scale,
      p3x,
      p3y,
      0,
      st,
    );

    const edx = p3x - st.lastX;
    const edy = p3y - st.lastY;
    st.accumDist += Math.floor(Math.sqrt(edx * edx + edy * edy));

    return st.accumDist / scale;
  }

  getAllPoints(): Point[] {
    return this.cachedPoints;
  }

  /**
   * Move forward along the curve by the given distance/speed step.
   * Returns the next cached point, or null if at the end.
   */
  increment(distance: number = 1): Point | null {
    this.accumulatedDistanceScaled += Math.max(
      1,
      Math.round(distance * DistanceBasedBezierCurve.SUB_SCALE),
    );

    while (
      this.currentIndex < this.cachedPoints.length - 1 &&
      this.accumulatedDistanceScaled >= this.pixelSpacingScaled
    ) {
      this.currentIndex++;
      this.accumulatedDistanceScaled -= this.pixelSpacingScaled;
    }

    if (this.currentIndex >= this.cachedPoints.length - 1) {
      return null;
    }
    return this.cachedPoints[this.currentIndex];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Precompute curve points using Single-Pass In-Order Recursive De Casteljau Subdivision.
   * Uses IEEE 754 exact-rounded Math.floor(Math.sqrt(...)) for deterministic integer distance accumulation.
   */
  computeAllPoints(pixelSpacing: number): void {
    this.cachedPoints = [];
    this.currentIndex = 0;
    this.accumulatedDistanceScaled = 0;
    this.pixelSpacingScaled = Math.max(
      DistanceBasedBezierCurve.SUB_SCALE,
      Math.round(pixelSpacing * DistanceBasedBezierCurve.SUB_SCALE),
    );

    const scale = DistanceBasedBezierCurve.SUB_SCALE; // 8-bit fixed-point precision
    const stepThreshold = this.pixelSpacingScaled;

    const p0x = Math.round(this.p0.x) * scale;
    const p0y = Math.round(this.p0.y) * scale;
    const p3x = Math.round(this.p3.x) * scale;
    const p3y = Math.round(this.p3.y) * scale;

    const st = {
      lastX: p0x,
      lastY: p0y,
      accumDist: 0,
      stepThreshold,
      cachedPoints: this.cachedPoints,
    };
    this.cachedPoints.push({
      x: (p0x + 128) >> 8,
      y: (p0y + 128) >> 8,
    });

    // Single-pass recursive midpoint subdivision and inline spatial filtering
    DistanceBasedBezierCurve.sharedSubdivide(
      p0x,
      p0y,
      Math.round(this.p1.x) * scale,
      Math.round(this.p1.y) * scale,
      Math.round(this.p2.x) * scale,
      Math.round(this.p2.y) * scale,
      p3x,
      p3y,
      0,
      st,
    );

    // Ensure endpoint is included if not already P3
    const lastPt = {
      x: (p3x + 128) >> 8,
      y: (p3y + 128) >> 8,
    };
    const lastIndex = this.cachedPoints.length - 1;
    if (lastIndex >= 0) {
      const endCached = this.cachedPoints[lastIndex];
      if (endCached.x !== lastPt.x || endCached.y !== lastPt.y) {
        this.cachedPoints.push(lastPt);
      }
    } else {
      this.cachedPoints.push(lastPt);
    }
  }

  private static sharedSubdivide(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
    depth: number,
    st: {
      lastX: number;
      lastY: number;
      accumDist: number;
      stepThreshold?: number;
      cachedPoints?: Point[];
    },
  ): void {
    const dist =
      Math.abs(bx - ax) +
      Math.abs(by - ay) +
      Math.abs(cx - bx) +
      Math.abs(cy - by) +
      Math.abs(dx - cx) +
      Math.abs(dy - cy);
    if (dist <= 256 || depth >= 10) {
      const edx = ax - st.lastX;
      const edy = ay - st.lastY;

      st.accumDist += Math.floor(Math.sqrt(edx * edx + edy * edy));
      st.lastX = ax;
      st.lastY = ay;

      if (st.stepThreshold !== undefined && st.cachedPoints !== undefined) {
        while (st.accumDist >= st.stepThreshold) {
          st.cachedPoints.push({
            x: (ax + 128) >> 8,
            y: (ay + 128) >> 8,
          });
          st.accumDist -= st.stepThreshold;
        }
      }
      return;
    }

    // De Casteljau midpoints via bitwise right-shift >> 1
    const m01_x = (ax + bx) >> 1;
    const m01_y = (ay + by) >> 1;
    const m12_x = (bx + cx) >> 1;
    const m12_y = (by + cy) >> 1;
    const m23_x = (cx + dx) >> 1;
    const m23_y = (cy + dy) >> 1;

    const m012_x = (m01_x + m12_x) >> 1;
    const m012_y = (m01_y + m12_y) >> 1;
    const m123_x = (m12_x + m23_x) >> 1;
    const m123_y = (m12_y + m23_y) >> 1;

    const mx = (m012_x + m123_x) >> 1;
    const my = (m012_y + m123_y) >> 1;

    // IN-ORDER RECURSION: Left segment first, then Right segment
    DistanceBasedBezierCurve.sharedSubdivide(
      ax,
      ay,
      m01_x,
      m01_y,
      m012_x,
      m012_y,
      mx,
      my,
      depth + 1,
      st,
    );
    DistanceBasedBezierCurve.sharedSubdivide(
      mx,
      my,
      m123_x,
      m123_y,
      m23_x,
      m23_y,
      dx,
      dy,
      depth + 1,
      st,
    );
  }
}
