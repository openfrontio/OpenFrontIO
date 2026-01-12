import { describe, expect, it } from "vitest";
import {
  ConnectedComponents,
  LAND_MARKER,
} from "../../../src/core/pathfinding/algorithms/ConnectedComponents";
import { createGameMap, createIslandMap, L, W } from "./_fixtures";

// prettier-ignore
const twoComponentsMapData = {
  width: 7, height: 5, grid: [
    W, W, L, L, L, W, W,
    W, W, L, L, L, W, W,
    W, W, L, L, L, W, W,
    W, W, L, L, L, W, W,
    W, W, L, L, L, W, W,
  ],
};

describe("ConnectedComponents", () => {
  describe("getComponentId", () => {
    it("returns 0 before initialization", () => {
      const map = createGameMap(createIslandMap());
      const wc = new ConnectedComponents(map);

      // Water tile at (0,0) - should return 0 (not initialized)
      const waterTile = map.ref(0, 0);
      expect(wc.getComponentId(waterTile)).toBe(0);
    });

    it("returns same component ID for all water tiles in single connected area", () => {
      const map = createGameMap(createIslandMap());
      const wc = new ConnectedComponents(map);
      wc.initialize();

      const water1 = map.ref(0, 0);
      const water2 = map.ref(4, 0);
      const water3 = map.ref(0, 4);
      const water4 = map.ref(4, 4);

      expect(map.isWater(water1)).toBe(true);
      expect(map.isWater(water2)).toBe(true);
      expect(map.isWater(water3)).toBe(true);
      expect(map.isWater(water4)).toBe(true);

      const id1 = wc.getComponentId(water1);
      const id2 = wc.getComponentId(water2);
      const id3 = wc.getComponentId(water3);
      const id4 = wc.getComponentId(water4);

      expect(id1).toBe(1);
      expect(id2).toBe(id1);
      expect(id3).toBe(id1);
      expect(id4).toBe(id1);
    });

    it("returns different component IDs for disconnected water areas", () => {
      const map = createGameMap(twoComponentsMapData);
      const wc = new ConnectedComponents(map);
      wc.initialize();

      const leftWater1 = map.ref(0, 0);
      const leftWater2 = map.ref(1, 2);
      const rightWater1 = map.ref(5, 0);
      const rightWater2 = map.ref(6, 4);

      expect(map.isWater(leftWater1)).toBe(true);
      expect(map.isWater(leftWater2)).toBe(true);
      expect(map.isWater(rightWater1)).toBe(true);
      expect(map.isWater(rightWater2)).toBe(true);

      const leftId1 = wc.getComponentId(leftWater1);
      const leftId2 = wc.getComponentId(leftWater2);
      const rightId1 = wc.getComponentId(rightWater1);
      const rightId2 = wc.getComponentId(rightWater2);

      expect(leftId1).not.toBe(rightId1);

      expect(leftId1).toBe(leftId2);
      expect(leftId1).toBeGreaterThan(0);
      expect(leftId1).not.toBe(LAND_MARKER);

      expect(rightId1).toBe(rightId2);
      expect(rightId1).toBeGreaterThan(0);
      expect(rightId1).not.toBe(LAND_MARKER);
    });

    it("returns LAND_MARKER for land tiles", () => {
      const map = createGameMap(twoComponentsMapData);
      const wc = new ConnectedComponents(map);
      wc.initialize();

      const landTile1 = map.ref(2, 0);
      const landTile2 = map.ref(3, 2);
      const landTile3 = map.ref(4, 4);

      expect(map.isLand(landTile1)).toBe(true);
      expect(map.isLand(landTile2)).toBe(true);
      expect(map.isLand(landTile3)).toBe(true);

      expect(wc.getComponentId(landTile1)).toBe(LAND_MARKER);
      expect(wc.getComponentId(landTile2)).toBe(LAND_MARKER);
      expect(wc.getComponentId(landTile3)).toBe(LAND_MARKER);
    });
  });

  describe("determinism", () => {
    it("produces same component IDs on repeated initialization", () => {
      const map = createGameMap(twoComponentsMapData);
      const wc1 = new ConnectedComponents(map);
      const wc2 = new ConnectedComponents(map);

      wc1.initialize();
      wc2.initialize();

      // Check all tiles have same component ID
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 7; x++) {
          const tile = map.ref(x, y);
          expect(wc1.getComponentId(tile)).toBe(wc2.getComponentId(tile));
        }
      }
    });
  });

  describe("direct terrain access optimization", () => {
    it("produces same results with accessTerrainDirectly=false", () => {
      const map = createGameMap(twoComponentsMapData);
      const wcDirect = new ConnectedComponents(map, true);
      const wcIndirect = new ConnectedComponents(map, false);

      wcDirect.initialize();
      wcIndirect.initialize();

      // Check all tiles have same component ID
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 7; x++) {
          const tile = map.ref(x, y);
          expect(wcDirect.getComponentId(tile)).toBe(
            wcIndirect.getComponentId(tile),
          );
        }
      }
    });
  });
});
