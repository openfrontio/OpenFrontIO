type Point = { x: number; y: number };

export class BezenhamLine {
  constructor(
    private p1: Point,
    private p2: Point,
  ) {
    this.dx = Math.abs(p2.x - p1.x);
    this.dy = Math.abs(p2.y - p1.y);
    this.sx = p1.x < p2.x ? 1 : -1;
    this.sy = p1.y < p2.y ? 1 : -1;
    this.error = this.dx - this.dy;
  }

  private dx: number;
  private dy: number;
  private sx: number;
  private sy: number;
  private error: number;

  size() {
    return Math.max(this.dx, this.dy) + 1;
  }

  // Increment either by 1 in x or y
  increment(): Point | true {
    if (this.p1.x === this.p2.x && this.p1.y === this.p2.y) {
      return true;
    }
    const x = this.p1.x;
    const y = this.p1.y;
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
    private p0: Point,
    private p1: Point,
    private p2: Point,
    private p3: Point,
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
  private totalDistance: number = 0;
  private distanceLUT: Array<{ t: number; distance: number }> = [];
  private lastFoundIndex: number = 0; // To keep track of the last found index

  increment(distance: number): Point | null {
    this.totalDistance += distance;
    const targetDistance = Math.min(
      this.totalDistance,
      this.distanceLUT[this.distanceLUT.length - 1]?.distance ||
        this.totalDistance,
    );
    const t = this.computeTForDistance(targetDistance);
    if (t >= 1) {
      return null; // end reached
    }
    return this.getPointAt(t);
  }

  /**
   * Generate @p numSteps segments, starting from the beginning of the curve
   * Each segment size is added in the LUT
   */
  generateCumulativeDistanceLUT(numSteps: number = 500): void {
    this.distanceLUT = [];
    let cumulativeDistance = 0;
    let prevPoint = this.getPointAt(0);

    for (let i = 1; i <= numSteps; i++) {
      const t = i / numSteps;
      const currentPoint = this.getPointAt(t);

      const dx = currentPoint.x - prevPoint.x;
      const dy = currentPoint.y - prevPoint.y;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      cumulativeDistance += segmentLength;
      this.distanceLUT.push({ t, distance: cumulativeDistance });
      prevPoint = currentPoint;
    }
  }

  computeTForDistance(distance: number): number {
    if (this.distanceLUT.length === 0) {
      this.generateCumulativeDistanceLUT();
    }
    if (distance <= 0) return 0;
    if (distance >= this.distanceLUT[this.distanceLUT.length - 1].distance) {
      return 1;
    }

    let lowerIndex = this.lastFoundIndex;
    let upperIndex = this.distanceLUT.length - 1;
    // Binary search for the closest range
    while (upperIndex - lowerIndex > 1) {
      const midIndex = Math.floor((upperIndex + lowerIndex) / 2);
      if (this.distanceLUT[midIndex].distance < distance) {
        lowerIndex = midIndex;
      } else {
        upperIndex = midIndex;
      }
    }

    const lower = this.distanceLUT[lowerIndex];
    const upper = this.distanceLUT[upperIndex];
    this.lastFoundIndex = lowerIndex;

    // Linear interpolation of t based on the distance
    const t =
      lower.t +
      ((distance - lower.distance) * (upper.t - lower.t)) /
        (upper.distance - lower.distance);
    return t;
  }
}
