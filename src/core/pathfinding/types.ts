/**
 * Core pathfinding types and interfaces.
 * No dependencies - safe to import from anywhere.
 */

export enum PathStatus {
  NEXT = 0,
  COMPLETE = 2,
  NOT_FOUND = 3,
}

export type PathResult<T> =
  | { status: PathStatus.NEXT; node: T }
  | { status: PathStatus.COMPLETE; node: T }
  | { status: PathStatus.NOT_FOUND };

/**
 * PathFinder - core pathfinding interface.
 * Implementations find paths between nodes.
 */
export interface PathFinder<T> {
  findPath(from: T | T[], to: T): T[] | null;
  /**
   * Optional: returns a sparse keypoint polyline with per-segment step counts.
   * Only implemented for TileRef-style (number) pathfinders.
   *
   * `points.length === segmentSteps.length + 1` when present.
   */
  planSegments?(from: T | T[], to: T): SegmentPlan | null;
}

export type SegmentPlan = {
  points: Uint32Array;
  segmentSteps: Uint32Array;
};

/**
 * SteppingPathFinder - PathFinder with stepping support.
 * Used by execution classes that need incremental path traversal.
 */
export interface SteppingPathFinder<T> extends PathFinder<T> {
  next(from: T, to: T, dist?: number): PathResult<T>;
  invalidate(): void;
}
