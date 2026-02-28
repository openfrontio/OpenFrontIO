import {
  PathFinder,
  PathResult,
  PathStatus,
  SegmentPlan,
  SteppingPathFinder,
} from "./types";

export interface StepperConfig<T> {
  equals: (a: T, b: T) => boolean;
  distance?: (a: T, b: T) => number;
  preCheck?: (from: T, to: T) => PathResult<T> | null;
}

/**
 * PathFinderStepper - wraps a PathFinder and provides step-by-step traversal
 *
 * Handles path caching, invalidation, and incremental movement.
 * Generic over any PathFinder<T> implementation.
 */
export class PathFinderStepper<T> implements SteppingPathFinder<T> {
  private path: T[] | null = null;
  private pathIndex = 0;
  private lastTo: T | null = null;

  constructor(
    private finder: PathFinder<T>,
    private config: StepperConfig<T> = { equals: (a, b) => a === b },
  ) {}

  /**
   * Get the next step on the path from `from` to `to`.
   * Returns PathResult with status and optional next node.
   */
  next(from: T, to: T, dist?: number): PathResult<T> {
    // Domain-specific pre-check (validation, cluster, etc.)
    if (this.config.preCheck) {
      const result = this.config.preCheck(from, to);
      if (result) return result;
    }

    if (this.config.equals(from, to)) {
      return { status: PathStatus.COMPLETE, node: to };
    }

    // Distance-based early exit
    if (dist !== undefined && dist > 0 && this.config.distance) {
      if (this.config.distance(from, to) <= dist) {
        return { status: PathStatus.COMPLETE, node: from };
      }
    }

    // Invalidate cache if destination changed
    if (this.lastTo === null || !this.config.equals(this.lastTo, to)) {
      this.path = null;
      this.pathIndex = 0;
      this.lastTo = to;
    }

    // Compute path if not cached
    if (this.path === null) {
      try {
        this.path = this.finder.findPath(from, to);
      } catch (err) {
        console.error("PathFinder threw an error during findPath", err);
        return { status: PathStatus.NOT_FOUND };
      }

      if (this.path === null) {
        return { status: PathStatus.NOT_FOUND };
      }

      this.pathIndex = 0;
      if (this.path.length > 0 && this.config.equals(this.path[0], from)) {
        this.pathIndex = 1;
      }
    }

    const expectedPos = this.path[this.pathIndex - 1];
    if (this.pathIndex > 0 && !this.config.equals(from, expectedPos)) {
      this.invalidate();
      this.lastTo = to;
      return this.next(from, to, dist);
    }

    // Check if we've reached the end
    if (this.pathIndex >= this.path.length) {
      return { status: PathStatus.COMPLETE, node: to };
    }

    // Return next step
    const nextNode = this.path[this.pathIndex];
    this.pathIndex++;

    return { status: PathStatus.NEXT, node: nextNode };
  }

  invalidate(): void {
    this.path = null;
    this.pathIndex = 0;
    this.lastTo = null;
  }

  findPath(from: T | T[], to: T): T[] | null {
    if (this.config.preCheck) {
      const fromArray = Array.isArray(from) ? from : [from];

      const allFailed = fromArray.every((f) => {
        const result = this.config.preCheck!(f, to);
        return result?.status === PathStatus.NOT_FOUND;
      });

      if (allFailed) {
        if (!Array.isArray(from)) {
          this.path = null;
          this.pathIndex = 0;
          this.lastTo = to;
        }
        return null;
      }
    }

    const isSingleSource = !Array.isArray(from);
    if (isSingleSource) {
      if (this.lastTo === null || !this.config.equals(this.lastTo, to)) {
        this.path = null;
        this.pathIndex = 0;
        this.lastTo = to;
      }
    }

    const path = this.finder.findPath(from, to);

    if (isSingleSource) {
      if (path === null) {
        this.path = null;
        this.pathIndex = 0;
        return null;
      }

      this.path = path;
      this.pathIndex = 0;
      if (path.length > 0 && this.config.equals(path[0], from)) {
        this.pathIndex = 1;
      }
      this.lastTo = to;
    }

    return path;
  }

  planSegments(from: T | T[], to: T): SegmentPlan | null {
    if (this.config.preCheck) {
      if (Array.isArray(from)) {
        const allFailed = from.every((f) => {
          const result = this.config.preCheck!(f, to);
          return result?.status === PathStatus.NOT_FOUND;
        });
        if (allFailed) {
          return null;
        }
      } else {
        const result = this.config.preCheck(from, to);
        if (result?.status === PathStatus.NOT_FOUND) {
          return null;
        }
      }
    }

    if (!Array.isArray(from) && this.config.equals(from, to)) {
      if (typeof (from as any) !== "number") {
        return null;
      }
      return {
        points: Uint32Array.from([from as any]),
        segmentSteps: new Uint32Array(0),
      };
    }

    if (Array.isArray(from)) {
      const path = this.findPath(from, to);
      if (path === null) {
        return null;
      }
      return this.compressDenseTilePath(path);
    }

    const cachedDense = this.cachedDenseSuffix(from, to);
    if (cachedDense !== null) {
      return this.compressDenseTilePath(cachedDense);
    }

    const path = this.findPath(from, to);
    if (path === null) {
      return null;
    }

    return this.compressDenseTilePath(
      this.normalizeSingleSourceDensePath(from, path),
    );
  }

  private cachedDenseSuffix(from: T, to: T): T[] | null {
    if (
      this.path === null ||
      this.lastTo === null ||
      !this.config.equals(this.lastTo, to)
    ) {
      return null;
    }

    if (this.pathIndex <= 0) {
      return null;
    }

    const expectedPos = this.path[this.pathIndex - 1];
    if (!this.config.equals(from, expectedPos)) {
      return null;
    }

    return this.path.slice(this.pathIndex - 1);
  }

  private normalizeSingleSourceDensePath(from: T, path: T[]): T[] {
    if (path.length === 0) {
      return [from];
    }
    if (this.config.equals(path[0], from)) {
      return path;
    }
    return [from, ...path];
  }

  private compressDenseTilePath(path: ArrayLike<T>): SegmentPlan | null {
    const count = path.length >>> 0;
    if (count === 0) {
      return null;
    }

    const first = path[0];
    if (typeof first !== "number") {
      return null;
    }

    let segmentCount = 0;
    let pointCount = 1;
    let prev = first as number;
    let hasRun = false;
    let runDelta = 0;

    for (let i = 1; i < count; i++) {
      const node = path[i];
      if (typeof node !== "number") {
        return null;
      }

      const cur = node as number;
      const delta = cur - prev;
      prev = cur;
      if (delta === 0) {
        continue;
      }

      if (!hasRun) {
        hasRun = true;
        runDelta = delta;
        segmentCount = 1;
        pointCount = 2;
        continue;
      }

      if (delta !== runDelta) {
        runDelta = delta;
        segmentCount++;
        pointCount++;
      }
    }

    if (segmentCount === 0) {
      return {
        points: Uint32Array.from([(first as number) >>> 0]),
        segmentSteps: new Uint32Array(0),
      };
    }

    const points = new Uint32Array(pointCount);
    const segmentSteps = new Uint32Array(segmentCount);
    points[0] = (first as number) >>> 0;

    let seg = 0;
    let steps = 0;
    runDelta = 0;
    prev = first as number;

    for (let i = 1; i < count; i++) {
      const cur = path[i] as number;
      const delta = cur - prev;
      if (delta === 0) {
        prev = cur;
        continue;
      }

      if (steps === 0) {
        runDelta = delta;
        steps = 1;
        prev = cur;
        continue;
      }

      if (delta === runDelta) {
        steps++;
        prev = cur;
        continue;
      }

      const runEnd = path[i - 1];
      if (typeof runEnd !== "number") {
        return null;
      }
      segmentSteps[seg] = steps >>> 0;
      points[seg + 1] = runEnd >>> 0;
      seg++;

      runDelta = delta;
      steps = 1;
      prev = cur;
    }

    segmentSteps[seg] = steps >>> 0;
    points[seg + 1] = prev >>> 0;

    return { points, segmentSteps };
  }
}
