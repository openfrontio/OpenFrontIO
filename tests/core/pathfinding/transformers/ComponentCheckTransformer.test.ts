import { describe, expect, it } from "vitest";
import { ComponentCheckTransformer } from "../../../../src/core/pathfinding/transformers/ComponentCheckTransformer";
import { PathFinder } from "../../../../src/core/pathfinding/types";

describe("ComponentCheckTransformer", () => {
  // Mock PathFinder that records calls and returns a simple path
  function createMockPathFinder(): PathFinder<number> & {
    calls: Array<{ from: number | number[]; to: number }>;
  } {
    const calls: Array<{ from: number | number[]; to: number }> = [];

    return {
      calls,
      findPath(from: number | number[], to: number): number[] | null {
        calls.push({ from, to });
        const start = Array.isArray(from) ? from[0] : from;
        return [start, to];
      },
    };
  }

  // Component function: even numbers → component 0, odd → component 1
  const evenOddComponent = (t: number) => t % 2;

  describe("findPath", () => {
    it("delegates when source and destination in same component", () => {
      const inner = createMockPathFinder();
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      const result = transformer.findPath(2, 4); // both even → component 0

      expect(result).toEqual([2, 4]);
      expect(inner.calls).toHaveLength(1);
      expect(inner.calls[0]).toEqual({ from: 2, to: 4 });
    });

    it("returns null when source and destination in different components", () => {
      const inner = createMockPathFinder();
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      const result = transformer.findPath(2, 3); // even → odd

      expect(result).toBeNull();
      expect(inner.calls).toHaveLength(0); // inner not called
    });

    it("filters multiple sources to only valid ones", () => {
      const inner = createMockPathFinder();
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      // Sources: 1, 2, 3, 4 → odd, even, odd, even
      // Destination: 4 → even
      // Valid sources: 2, 4
      const result = transformer.findPath([1, 2, 3, 4], 4);

      expect(result).not.toBeNull();
      expect(inner.calls).toHaveLength(1);
      expect(inner.calls[0].from).toEqual([2, 4]); // filtered to valid
      expect(inner.calls[0].to).toBe(4);
    });

    it("returns null when no source in same component", () => {
      const inner = createMockPathFinder();
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      // All sources odd, destination even
      const result = transformer.findPath([1, 3, 5], 4);

      expect(result).toBeNull();
      expect(inner.calls).toHaveLength(0);
    });

    it("unwraps single valid source from array", () => {
      const inner = createMockPathFinder();
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      // Only one source matches
      const result = transformer.findPath([1, 2, 3], 4);

      expect(result).not.toBeNull();
      expect(inner.calls).toHaveLength(1);
      expect(inner.calls[0].from).toBe(2);
    });

    it("handles single source (not array)", () => {
      const inner = createMockPathFinder();
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      const result = transformer.findPath(4, 6);

      expect(result).toEqual([4, 6]);
      expect(inner.calls[0].from).toBe(4);
    });

    it("propagates null from inner pathfinder", () => {
      const inner: PathFinder<number> = {
        findPath: () => null,
      };
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      const result = transformer.findPath(2, 4);

      expect(result).toBeNull();
    });

    it("propagates path from inner pathfinder", () => {
      const inner: PathFinder<number> = {
        findPath: () => [10, 20, 30, 40],
      };
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      const result = transformer.findPath(2, 4);

      expect(result).toEqual([10, 20, 30, 40]);
    });
  });

  describe("edge cases", () => {
    it("handles empty source array", () => {
      const inner = createMockPathFinder();
      const transformer = new ComponentCheckTransformer(
        inner,
        evenOddComponent,
      );

      const result = transformer.findPath([], 4);

      expect(result).toBeNull();
      expect(inner.calls).toHaveLength(0);
    });

    it("works with custom component function", () => {
      const inner = createMockPathFinder();
      // Component by tens digit: 10-19 → 1, 20-29 → 2, etc.
      const tensComponent = (t: number) => Math.floor(t / 10);
      const transformer = new ComponentCheckTransformer(inner, tensComponent);

      // Same component
      expect(transformer.findPath(15, 18)).not.toBeNull();

      // Different component
      expect(transformer.findPath(15, 25)).toBeNull();
    });
  });
});
