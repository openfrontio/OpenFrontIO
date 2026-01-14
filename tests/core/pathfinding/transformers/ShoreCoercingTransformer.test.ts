import { describe, expect, it } from "vitest";
import { ShoreCoercingTransformer } from "../../../../src/core/pathfinding/transformers/ShoreCoercingTransformer";
import { PathFinder } from "../../../../src/core/pathfinding/types";
import { createGameMap, createIslandMap, L, W } from "../_fixtures";

describe("ShoreCoercingTransformer", () => {
  // Mock PathFinder that records calls and returns configurable path
  function createMockPathFinder(): PathFinder<number> & {
    calls: Array<{ from: number | number[]; to: number }>;
    returnPath: number[] | null | undefined;
  } {
    const mock = {
      calls: [] as Array<{ from: number | number[]; to: number }>,
      returnPath: undefined as number[] | null | undefined,
      findPath(from: number | number[], to: number): number[] | null {
        mock.calls.push({ from, to });
        if (mock.returnPath !== undefined) return mock.returnPath;
        const start = Array.isArray(from) ? from[0] : from;
        return [start, to];
      },
    };
    return mock;
  }

  describe("findPath", () => {
    it("passes water tiles unchanged", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      const water1 = map.ref(0, 0);
      const water2 = map.ref(4, 0);
      inner.returnPath = [water1, water2];

      const result = transformer.findPath(water1, water2);

      expect(result).toEqual([water1, water2]);
      expect(inner.calls).toHaveLength(1);
      expect(inner.calls[0].from).toBe(water1);
      expect(inner.calls[0].to).toBe(water2);
    });

    it("coerces shore start to water and prepends original", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      const shore = map.ref(1, 1);
      const water = map.ref(4, 4);
      const shoreWaterNeighbor = map.ref(1, 0);

      const result = transformer.findPath(shore, water);

      expect(result).not.toBeNull();
      expect(result![0]).toBe(shore);
      expect(result![1]).toBe(shoreWaterNeighbor);
    });

    it("coerces shore destination to water and appends original", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      const water = map.ref(0, 0);
      const shore = map.ref(1, 1);
      const shoreWaterNeighbor = map.ref(1, 0);

      const result = transformer.findPath(water, shore);

      expect(result).not.toBeNull();
      expect(result![0]).toBe(water);
      expect(result![result!.length - 2]).toBe(shoreWaterNeighbor);
      expect(result![result!.length - 1]).toBe(shore);
    });

    it("coerces both shore start and destination", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      const shore1 = map.ref(1, 1);
      const shore1WaterNeighbor = map.ref(1, 0);
      const shore2 = map.ref(3, 3);
      const shore2WaterNeighbor = map.ref(3, 4);

      const result = transformer.findPath(shore1, shore2);

      expect(result).not.toBeNull();
      expect(result![0]).toBe(shore1);
      expect(result![1]).toBe(shore1WaterNeighbor);
      expect(result![result!.length - 2]).toBe(shore2WaterNeighbor);
      expect(result![result!.length - 1]).toBe(shore2);
    });

    it("returns null when source has no water neighbor", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      // Center land tile (2,2) has no water neighbors
      const land = map.ref(2, 2);
      const water = map.ref(0, 0);

      const result = transformer.findPath(land, water);

      expect(result).toBeNull();
      expect(inner.calls).toHaveLength(0);
    });

    it("returns null when destination has no water neighbor", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      // Center land tile (2,2) has no water neighbors
      const land = map.ref(2, 2);
      const water = map.ref(0, 0);

      const result = transformer.findPath(water, land);

      expect(result).toBeNull();
      expect(inner.calls).toHaveLength(0);
    });

    it("returns null when inner pathfinder returns null", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      inner.returnPath = null;
      const result = transformer.findPath(map.ref(0, 0), map.ref(4, 4));

      expect(result).toBeNull();
    });

    it("returns null when inner pathfinder returns empty path", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      inner.returnPath = [];
      const result = transformer.findPath(map.ref(0, 0), map.ref(4, 4));

      expect(result).toBeNull();
    });

    it("handles multiple sources, filters invalid ones", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      const waterSrc = map.ref(0, 0);
      const shoreSrc = map.ref(1, 1);
      const landSrc = map.ref(2, 2);
      const waterDest = map.ref(4, 4);

      inner.returnPath = [waterSrc, waterDest];

      const result = transformer.findPath(
        [waterSrc, shoreSrc, landSrc],
        waterDest,
      );

      expect(result).not.toBeNull();
      expect(inner.calls).toHaveLength(1);

      const fromArg = inner.calls[0].from;
      expect(Array.isArray(fromArg)).toBe(true);
      expect((fromArg as number[]).length).toBe(2);
    });

    it("returns null when all sources are invalid", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      const land = map.ref(2, 2);

      const result = transformer.findPath([land], map.ref(0, 0));

      expect(result).toBeNull();
      expect(inner.calls).toHaveLength(0);
    });
  });

  describe("determinism", () => {
    it("shore with multiple water neighbors selects consistently", () => {
      // prettier-ignore
      const map = createGameMap({
        width: 5, height: 5, grid: [
          L, L, W, W, W,
          L, L, W, W, W,
          L, L, W, L, L,
          W, W, W, L, L,
          W, W, W, L, L,
        ],
      });

      const shoreWithMultipleWater = map.ref(1, 2);
      const expectedWaterNeighbor = map.ref(1, 3);

      const inner1 = createMockPathFinder();
      const inner2 = createMockPathFinder();
      const transformer1 = new ShoreCoercingTransformer(inner1, map);
      const transformer2 = new ShoreCoercingTransformer(inner2, map);

      const waterDest = map.ref(2, 4);

      transformer1.findPath(shoreWithMultipleWater, waterDest);
      transformer2.findPath(shoreWithMultipleWater, waterDest);

      // Both select the same water neighbor: (1,3)
      expect(inner1.calls[0].from).toBe(expectedWaterNeighbor);
      expect(inner2.calls[0].from).toBe(expectedWaterNeighbor);
    });

    it("corner shore with water neighbors works correctly", () => {
      const mapData = createIslandMap();
      const map = createGameMap(mapData);
      const inner = createMockPathFinder();
      const transformer = new ShoreCoercingTransformer(inner, map);

      const cornerShore = map.ref(1, 1);
      const waterNeighbor = map.ref(1, 0);
      const waterDest = map.ref(4, 4);

      inner.returnPath = [waterNeighbor, waterDest];

      const result = transformer.findPath(cornerShore, waterDest);

      expect(result).not.toBeNull();
      expect(result).toEqual([cornerShore, waterNeighbor, waterDest]);
    });
  });
});
