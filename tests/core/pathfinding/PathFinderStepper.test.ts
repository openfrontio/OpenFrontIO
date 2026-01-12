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
});
