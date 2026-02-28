import { describe, expect, it } from "vitest";
import { PathFinderStepper } from "../../../src/core/pathfinding/PathFinderStepper";
import { PathFinder, PathStatus } from "../../../src/core/pathfinding/types";

describe("PathFinderStepper", () => {
  function createMockFinder(
    pathMap: Map<string, number[]>,
  ): PathFinder<number> {
    return {
      findPath(from: number | number[], to: number): number[] | null {
        const fromTile = Array.isArray(from) ? from[0] : from;
        const key = `${fromTile}->${to}`;
        return pathMap.get(key) ?? null;
      },
    };
  }

  describe("next", () => {
    it("returns COMPLETE when at destination", () => {
      const pathMap = new Map<string, number[]>();
      const stepper = new PathFinderStepper(createMockFinder(pathMap));

      const result = stepper.next(5, 5);

      expect(result.status).toBe(PathStatus.COMPLETE);
      expect((result as { node: number }).node).toBe(5);
    });

    it("returns NEXT with path nodes sequentially", () => {
      const pathMap = new Map<string, number[]>([["1->4", [1, 2, 3, 4]]]);
      const stepper = new PathFinderStepper(createMockFinder(pathMap));

      // First step: 1 -> 4, returns 2
      const result1 = stepper.next(1, 4);
      expect(result1.status).toBe(PathStatus.NEXT);
      expect((result1 as { node: number }).node).toBe(2);

      // Second step: from 2, returns 3
      const result2 = stepper.next(2, 4);
      expect(result2.status).toBe(PathStatus.NEXT);
      expect((result2 as { node: number }).node).toBe(3);

      // Third step: from 3, returns 4
      const result3 = stepper.next(3, 4);
      expect(result3.status).toBe(PathStatus.NEXT);
      expect((result3 as { node: number }).node).toBe(4);

      // Fourth step: at destination
      const result4 = stepper.next(4, 4);
      expect(result4.status).toBe(PathStatus.COMPLETE);
    });

    it("returns NOT_FOUND when no path exists", () => {
      const pathMap = new Map<string, number[]>();
      const stepper = new PathFinderStepper(createMockFinder(pathMap));

      const result = stepper.next(1, 99);

      expect(result.status).toBe(PathStatus.NOT_FOUND);
    });

    it("recomputes path when moved off-path", () => {
      // Path from 1->5 goes through 2,3,4
      // Path from 10->5 goes through 9,8,7,6
      const pathMap = new Map<string, number[]>([
        ["1->5", [1, 2, 3, 4, 5]],
        ["10->5", [10, 9, 8, 7, 6, 5]],
      ]);
      const stepper = new PathFinderStepper(createMockFinder(pathMap));

      // Start on path 1->5
      const result1 = stepper.next(1, 5);
      expect(result1.status).toBe(PathStatus.NEXT);
      expect((result1 as { node: number }).node).toBe(2);

      // Move off-path to tile 10 (not on original path)
      // Should recompute using path from 10->5
      const result2 = stepper.next(10, 5);
      expect(result2.status).toBe(PathStatus.NEXT);
      expect((result2 as { node: number }).node).toBe(9);
    });

    it("recomputes path when destination changes", () => {
      const pathMap = new Map<string, number[]>([
        ["1->5", [1, 2, 3, 4, 5]],
        ["2->9", [2, 6, 7, 8, 9]],
      ]);
      const stepper = new PathFinderStepper(createMockFinder(pathMap));

      // Start on path 1->5
      const result1 = stepper.next(1, 5);
      expect(result1.status).toBe(PathStatus.NEXT);
      expect((result1 as { node: number }).node).toBe(2);

      // Change destination to 9 (from current position 2)
      const result2 = stepper.next(2, 9);
      expect(result2.status).toBe(PathStatus.NEXT);
      expect((result2 as { node: number }).node).toBe(6);
    });
  });

  describe("invalidate", () => {
    it("clears cached path so next recomputes", () => {
      let callCount = 0;
      const finder: PathFinder<number> = {
        findPath(from, to): number[] | null {
          callCount++;
          const fromTile = Array.isArray(from) ? from[0] : from;
          return [fromTile, to];
        },
      };
      const stepper = new PathFinderStepper(finder);

      stepper.next(1, 5);
      stepper.next(5, 5);

      // Second call follows path without recomputing
      expect(callCount).toBe(1);

      stepper.invalidate();
      stepper.next(1, 5);

      // Recomputed path after invalidation
      expect(callCount).toBe(2);
    });
  });

  describe("findPath", () => {
    it("delegates to inner finder", () => {
      const pathMap = new Map<string, number[]>([["1->5", [1, 2, 3, 4, 5]]]);
      const stepper = new PathFinderStepper(createMockFinder(pathMap));

      const path = stepper.findPath(1, 5);

      expect(path).toEqual([1, 2, 3, 4, 5]);
    });

    it("supports multi-source", () => {
      const finder: PathFinder<number> = {
        findPath(from, to): number[] | null {
          const firstFrom = Array.isArray(from) ? from[0] : from;
          return [firstFrom, to];
        },
      };
      const stepper = new PathFinderStepper(finder);

      const path = stepper.findPath([1, 2, 3], 5);

      expect(path).toEqual([1, 5]);
    });
  });

  describe("custom equals", () => {
    it("uses custom equals function for position comparison", () => {
      type Pos = { x: number; y: number };
      const posEquals = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;

      const finder: PathFinder<Pos> = {
        findPath(from, to): Pos[] | null {
          const f = Array.isArray(from) ? from[0] : from;
          return [f, { x: 2, y: 0 }, to];
        },
      };

      const stepper = new PathFinderStepper(finder, { equals: posEquals });

      const from1 = { x: 1, y: 0 };
      const to = { x: 3, y: 0 };

      const result1 = stepper.next(from1, to);
      expect(result1.status).toBe(PathStatus.NEXT);

      // Use equivalent but different object (a !== b), still on track
      const result2 = stepper.next({ x: 2, y: 0 }, to);
      expect(result2.status).toBe(PathStatus.NEXT);
      expect((result2 as { node: Pos }).node).toEqual({ x: 3, y: 0 });
    });
  });

  describe("planSegments", () => {
    it("compresses dense paths into delta runs", () => {
      const path = [10, 11, 12, 13, 23, 33, 43];
      const stepper = new PathFinderStepper<number>({
        findPath: () => path.slice(),
      });

      const plan = stepper.planSegments(10, 43);

      expect(plan).not.toBeNull();
      if (!plan) return;
      expect(Array.from(plan.points)).toEqual([10, 13, 43]);
      expect(Array.from(plan.segmentSteps)).toEqual([3, 3]);
    });

    it("reuses cached suffix after next() without an extra findPath call", () => {
      let calls = 0;
      const path = [1, 2, 3, 4, 14, 24];
      const stepper = new PathFinderStepper<number>({
        findPath: () => {
          calls++;
          return path.slice();
        },
      });

      const r1 = stepper.next(1, 24);
      expect(r1.status).toBe(PathStatus.NEXT);
      const r2 = stepper.next(2, 24);
      expect(r2.status).toBe(PathStatus.NEXT);
      expect(calls).toBe(1);

      const plan = stepper.planSegments(3, 24);

      expect(plan).not.toBeNull();
      if (!plan) return;
      expect(calls).toBe(1);
      expect(Array.from(plan.points)).toEqual([3, 4, 24]);
      expect(Array.from(plan.segmentSteps)).toEqual([1, 2]);
    });

    it("prepends source when the returned dense path omits it", () => {
      const stepper = new PathFinderStepper<number>({
        findPath: () => [11, 12, 22],
      });

      const plan = stepper.planSegments(10, 22);

      expect(plan).not.toBeNull();
      if (!plan) return;
      expect(Array.from(plan.points)).toEqual([10, 12, 22]);
      expect(Array.from(plan.segmentSteps)).toEqual([2, 1]);
    });

    it("skips zero-delta nodes while preserving run counts", () => {
      const stepper = new PathFinderStepper<number>({
        findPath: () => [10, 10, 11, 12, 22, 22, 32, 31],
      });

      const plan = stepper.planSegments(10, 31);

      expect(plan).not.toBeNull();
      if (!plan) return;
      expect(Array.from(plan.points)).toEqual([10, 12, 32, 31]);
      expect(Array.from(plan.segmentSteps)).toEqual([2, 2, 1]);
    });

    it("returns a single-point plan when from equals to", () => {
      let calls = 0;
      const stepper = new PathFinderStepper<number>({
        findPath: () => {
          calls++;
          return [5];
        },
      });

      const plan = stepper.planSegments(5, 5);

      expect(plan).not.toBeNull();
      if (!plan) return;
      expect(calls).toBe(0);
      expect(Array.from(plan.points)).toEqual([5]);
      expect(plan.segmentSteps.length).toBe(0);
    });

    it("returns null when no path exists", () => {
      const stepper = new PathFinderStepper<number>({
        findPath: () => null,
      });

      const plan = stepper.planSegments(1, 99);
      expect(plan).toBeNull();
    });

    it("supports multi-source by compressing the returned dense path once", () => {
      let calls = 0;
      const stepper = new PathFinderStepper<number>({
        findPath: (from) => {
          calls++;
          if (!Array.isArray(from)) {
            return null;
          }
          return [from[1], from[1] + 1, from[1] + 2];
        },
      });

      const plan = stepper.planSegments([10, 20], 22);

      expect(plan).not.toBeNull();
      if (!plan) return;
      expect(calls).toBe(1);
      expect(Array.from(plan.points)).toEqual([20, 22]);
      expect(Array.from(plan.segmentSteps)).toEqual([2]);
    });
  });
});
