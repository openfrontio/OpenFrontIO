// Component check transformer - fail fast if src/dst in different components

import { PathFinder } from "../types";

/**
 * Wraps a PathFinder to fail fast when source and destination
 * are in different components (e.g., disconnected water bodies).
 *
 * Avoids running expensive pathfinding when no path exists.
 */
export class ComponentCheckTransformer<T> implements PathFinder<T> {
  private lastPlanFrom: T | T[] | null = null;
  private lastPlanTo: T | null = null;
  private lastPlan = null as ReturnType<
    NonNullable<PathFinder<T>["planSegments"]>
  >;

  constructor(
    private inner: PathFinder<T>,
    private getComponent: (t: T) => number,
  ) {}

  findPath(from: T | T[], to: T): T[] | null {
    const toComponent = this.getComponent(to);

    // Check all sources - at least one must match destination component
    const fromArray = Array.isArray(from) ? from : [from];
    const validSources = fromArray.filter(
      (f) => this.getComponent(f) === toComponent,
    );

    if (validSources.length === 0) {
      return null; // No source in same component as destination
    }

    // Delegate with only valid sources
    const delegateFrom =
      validSources.length === 1 ? validSources[0] : validSources;
    const path = this.inner.findPath(delegateFrom, to);
    this.lastPlanFrom = from;
    this.lastPlanTo = to;
    this.lastPlan = this.inner.planSegments?.(delegateFrom, to) ?? null;
    return path;
  }

  planSegments(from: T | T[], to: T) {
    if (
      this.lastPlanTo === to &&
      this.lastPlanFrom === from &&
      this.lastPlan !== null
    ) {
      return this.lastPlan;
    }

    const toComponent = this.getComponent(to);
    const fromArray = Array.isArray(from) ? from : [from];
    const validSources = fromArray.filter(
      (f) => this.getComponent(f) === toComponent,
    );

    if (validSources.length === 0) {
      this.lastPlanFrom = from;
      this.lastPlanTo = to;
      this.lastPlan = null;
      return null;
    }

    const delegateFrom =
      validSources.length === 1 ? validSources[0] : validSources;

    // Ensure inner has a fresh cached plan (if any) for these args.
    this.inner.findPath(delegateFrom, to);
    this.lastPlanFrom = from;
    this.lastPlanTo = to;
    this.lastPlan = this.inner.planSegments?.(delegateFrom, to) ?? null;
    return this.lastPlan;
  }
}
