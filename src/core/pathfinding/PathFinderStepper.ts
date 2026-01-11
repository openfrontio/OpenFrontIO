import {
  PathFinder,
  PathResult,
  PathStatus,
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
      const first = Array.isArray(from) ? from[0] : from;
      const result = this.config.preCheck(first, to);
      if (result?.status === PathStatus.NOT_FOUND) return null;
    }

    return this.finder.findPath(from, to);
  }
}
