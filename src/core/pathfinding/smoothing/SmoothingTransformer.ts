import { PathFinder } from "../types";
import { PathSmoother } from "./PathSmoother";

/**
 * Transformer that applies path smoothing to any PathFinder.
 * Wraps an inner PathFinder and smooths its output.
 */
export class SmoothingTransformer<T> implements PathFinder<T> {
  constructor(
    private inner: PathFinder<T>,
    private smoother: PathSmoother<T>,
  ) {}

  findPath(from: T | T[], to: T): T[] | null {
    const path = this.inner.findPath(from, to);
    return path ? this.smoother.smooth(path) : null;
  }
}
