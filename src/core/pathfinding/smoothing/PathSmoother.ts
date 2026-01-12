/**
 * PathSmoother - interface for path smoothing algorithms.
 * Takes a path and returns a smoothed version.
 */
export interface PathSmoother<T> {
  smooth(path: T[]): T[];
}
