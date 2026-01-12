import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../../../src/core/game/GameMap";
import { MiniMapTransformer } from "../../../../src/core/pathfinding/transformers/MiniMapTransformer";
import { PathFinder } from "../../../../src/core/pathfinding/types";

describe("MiniMapTransformer", () => {
  // Create test maps: main map is 10x10, minimap is 5x5 (2x downscale)
  function createTestMaps() {
    const W = 0x20; // Water
    const mainTerrain = new Uint8Array(100).fill(W); // 10x10 all water
    const miniTerrain = new Uint8Array(25).fill(W); // 5x5 all water

    const map = new GameMapImpl(10, 10, mainTerrain, 0);
    const miniMap = new GameMapImpl(5, 5, miniTerrain, 0);

    return { map, miniMap };
  }

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
    it("converts coordinates to minimap scale", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      const from = map.ref(4, 6);
      const to = map.ref(8, 2);

      const miniFrom = miniMap.ref(2, 3);
      const miniTo = miniMap.ref(4, 1);
      inner.returnPath = [miniFrom, miniTo];

      transformer.findPath(from, to);

      expect(inner.calls).toHaveLength(1);
      expect(inner.calls[0].from).toBe(miniFrom);
      expect(inner.calls[0].to).toBe(miniTo);
    });

    it("upscales minimap path back to full resolution", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      const from = map.ref(0, 0);
      const to = map.ref(8, 0);

      // Minimap path: (0,0) → (4,0) - straight horizontal
      inner.returnPath = [
        miniMap.ref(0, 0),
        miniMap.ref(1, 0),
        miniMap.ref(2, 0),
        miniMap.ref(3, 0),
        miniMap.ref(4, 0),
      ];

      const result = transformer.findPath(from, to);

      expect(result).not.toBeNull();
      expect(result![0]).toBe(from);
      expect(result![result!.length - 1]).toBe(to);
    });

    it("returns null when inner returns null", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      inner.returnPath = null;
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      const result = transformer.findPath(map.ref(0, 0), map.ref(8, 8));

      expect(result).toBeNull();
    });

    it("returns null when inner returns empty path", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      inner.returnPath = [];
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      const result = transformer.findPath(map.ref(0, 0), map.ref(8, 8));

      expect(result).toBeNull();
    });

    it("handles multiple sources", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      const from1 = map.ref(0, 0);
      const from2 = map.ref(2, 0);
      const to = map.ref(8, 0);

      inner.returnPath = [miniMap.ref(0, 0), miniMap.ref(4, 0)];

      const result = transformer.findPath([from1, from2], to);

      expect(inner.calls).toHaveLength(1);
      expect(Array.isArray(inner.calls[0].from)).toBe(true);
      expect(result).not.toBeNull();
    });

    it("fixes path extremes to match original from/to", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      // From odd coords - won't exactly map to minimap
      const from = map.ref(1, 1);
      const to = map.ref(9, 9);

      inner.returnPath = [miniMap.ref(0, 0), miniMap.ref(4, 4)];

      const result = transformer.findPath(from, to);

      expect(result).not.toBeNull();
      expect(result![0]).toBe(from);
      expect(result![result!.length - 1]).toBe(to);
    });
  });

  describe("coordinate mapping", () => {
    it("maps main coords (0,0) to mini coords (0,0)", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      inner.returnPath = [miniMap.ref(0, 0)];

      transformer.findPath(map.ref(0, 0), map.ref(0, 0));

      expect(inner.calls[0].from).toBe(miniMap.ref(0, 0));
      expect(inner.calls[0].to).toBe(miniMap.ref(0, 0));
    });

    it("maps main coords (1,1) to mini coords (0,0) (floor division)", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      inner.returnPath = [miniMap.ref(0, 0)];

      transformer.findPath(map.ref(1, 1), map.ref(1, 1));

      expect(inner.calls[0].from).toBe(miniMap.ref(0, 0));
      expect(inner.calls[0].to).toBe(miniMap.ref(0, 0));
    });

    it("maps main coords (2,2) to mini coords (1,1)", () => {
      const { map, miniMap } = createTestMaps();
      const inner = createMockPathFinder();
      const transformer = new MiniMapTransformer(inner, map, miniMap);

      inner.returnPath = [miniMap.ref(1, 1)];

      transformer.findPath(map.ref(2, 2), map.ref(2, 2));

      expect(inner.calls[0].from).toBe(miniMap.ref(1, 1));
      expect(inner.calls[0].to).toBe(miniMap.ref(1, 1));
    });
  });
});
