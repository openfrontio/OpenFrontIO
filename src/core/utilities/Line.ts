type Point = { x: number; y: number };

export class BezenhamLine {
  constructor(
    private readonly p1: Point,
    private readonly p2: Point,
  ) {
    this.dx = Math.abs(p2.x - p1.x);
    this.dy = Math.abs(p2.y - p1.y);
    this.sx = p1.x < p2.x ? 1 : -1;
    this.sy = p1.y < p2.y ? 1 : -1;
    this.error = this.dx - this.dy;
  }

  private readonly dx: number;
  private readonly dy: number;
  private readonly sx: number;
  private readonly sy: number;
  private error: number;

  size() {
    return Math.max(this.dx, this.dy) + 1;
  }

  // Increment either by 1 in x or y
  increment(): Point | true {
    if (this.p1.x === this.p2.x && this.p1.y === this.p2.y) {
      return true;
    }
    const { x } = this.p1;
    const { y } = this.p1;
    const err2 = 2 * this.error;

    if (err2 > -this.dy) {
      this.error -= this.dy;
      this.p1.x += this.sx;
    }
    if (err2 < this.dx) {
      this.error += this.dx;
      this.p1.y += this.sy;
    }
    return { x, y };
  }
}

export class CubicBezierCurve {
  constructor(
    private readonly p0: Point,
    private readonly p1: Point,
    private readonly p2: Point,
    private readonly p3: Point,
  ) {}
  getPointAt(t: number): Point {
    const T = 1 - t;
    const TT = T * T;
    const TTT = TT * T;
    const tt = t * t;
    const ttt = tt * t;

    const x =
      TTT * this.p0.x +
      3 * TT * t * this.p1.x +
      3 * T * tt * this.p2.x +
      ttt * this.p3.x;

    const y =
      TTT * this.p0.y +
      3 * TT * t * this.p1.y +
      3 * T * tt * this.p2.y +
      ttt * this.p3.y;
    return { x, y };
  }
}

/**
 *  Use a cumulative distance LUT to approximate the traveled distance
 *  Useful to compute regular steps based on the curve rather than a t
 */
export class DistanceBasedBezierCurve extends CubicBezierCurve {
  private totalDistance = 0;
  private cachedPoints: Point[] = [];
  private currentIndex = 0;

  constructor(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    distanceIncrement: number,
  ) {
    super(p0, p1, p2, p3);
    this.computeAllPoints(distanceIncrement, 0.002);
  }

  getAllPoints(): Point[] {
    return this.cachedPoints;
  }
  /**
   * Move forward along the curve by the given distance.
   * Returns the next cached point, or null if at the end.
   */
  increment(distance: number): Point | null {
    this.totalDistance += distance;

    // Step forward through cached points until we're at the correct distance
    while (
      this.currentIndex < this.cachedPoints.length - 1 &&
      this.getDistanceUpToIndex(this.currentIndex + 1) < this.totalDistance
    ) {
      this.currentIndex++;
    }

    if (this.currentIndex >= this.cachedPoints.length - 1) {
      return null; // End of curve
    }

    return this.cachedPoints[this.currentIndex];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Precompute all points spaced @p pixelSpacing apart
   */
  computeAllPoints(pixelSpacing: number, precision: number): void {
    this.cachedPoints = [];
    this.totalDistance = 0;
    this.currentIndex = 0;

    let t = 0;
    let prevPoint = this.getPointAt(t);
    this.cachedPoints.push(prevPoint);

    let cumulativeDistance = 0;

    while (t < 1) {
      t = Math.min(t + precision, 1);
      const currentPoint = this.getPointAt(t);

      const dx = currentPoint.x - prevPoint.x;
      const dy = currentPoint.y - prevPoint.y;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);
      cumulativeDistance += segmentLength;

      if (cumulativeDistance >= pixelSpacing) {
        this.cachedPoints.push(currentPoint);
        cumulativeDistance = 0;
      }

      prevPoint = currentPoint;
    }

    // Make sure the last point is exactly at t=1
    const finalPoint = this.getPointAt(1);
    if (
      this.cachedPoints.length === 0 ||
      finalPoint.x !== this.cachedPoints[this.cachedPoints.length - 1].x ||
      finalPoint.y !== this.cachedPoints[this.cachedPoints.length - 1].y
    ) {
      this.cachedPoints.push(finalPoint);
    }
  }

  /**
   * Optional helper: get distance along the cached points up to a given index
   */
  private getDistanceUpToIndex(index: number): number {
    let dist = 0;
    for (let i = 1; i <= index; i++) {
      const p1 = this.cachedPoints[i - 1];
      const p2 = this.cachedPoints[i];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      dist += Math.sqrt(dx * dx + dy * dy);
    }
    return dist;
  }
}
