export class BezenhamLine {
  constructor(
    private x0: number,
    private y0: number,
    private x1: number,
    private y1: number,
  ) {
    this.dx = Math.abs(this.x1 - this.x0);
    this.dy = Math.abs(this.y1 - this.y0);
    this.sx = this.x0 < this.x1 ? 1 : -1;
    this.sy = this.y0 < this.y1 ? 1 : -1;
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
  increment(): { x: number; y: number } | true {
    if (this.x0 === this.x1 && this.y0 === this.y1) {
      return true;
    }
    const x = this.x0;
    const y = this.y0;
    const err2 = 2 * this.error;

    if (err2 > -this.dy) {
      this.error -= this.dy;
      this.x0 += this.sx;
    }
    if (err2 < this.dx) {
      this.error += this.dx;
      this.y0 += this.sy;
    }
    return { x, y };
  }
}

export class BezierCurve {
  constructor(
    private x0: number,
    private y0: number,
    private x1: number,
    private y1: number,
  ) {
    this.controlPoint0X = x0;
    this.controlPoint0Y = y0;
    this.controlPoint1X = x1;
    this.controlPoint1Y = y1;
  }

  private controlPoint0X: number;
  private controlPoint0Y: number;
  private controlPoint1X: number;
  private controlPoint1Y: number;

  setControlPoint0(x, y) {
    this.controlPoint0X = x;
    this.controlPoint0Y = y;
  }

  setControlPoint1(x, y) {
    this.controlPoint1X = x;
    this.controlPoint1Y = y;
  }

  getPointAt(t: number): { x: number; y: number } {
    const x =
      Math.pow(1 - t, 3) * this.x0 +
      3 * Math.pow(1 - t, 2) * t * this.controlPoint0X +
      3 * (1 - t) * Math.pow(t, 2) * this.controlPoint1X +
      Math.pow(t, 3) * this.x1;
    const y =
      Math.pow(1 - t, 3) * this.y0 +
      3 * Math.pow(1 - t, 2) * t * this.controlPoint0Y +
      3 * (1 - t) * Math.pow(t, 2) * this.controlPoint1Y +
      Math.pow(t, 3) * this.y1;
    return { x, y };
  }
}

/**
 *  Use a cumulative distance LUT to approximate the traveled distance
 *  Useful to compute regular steps based on the curve rather than a t
 */
export class DistanceBasedBezierCurve extends BezierCurve {
  private totalDistance: number = 0;
  private distanceLUT: Array<{ t: number; distance: number }> = [];
  private lastFoundIndex: number = 0; // To keep track of the last found index

  increment(distance: number): { x: number; y: number } {
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
