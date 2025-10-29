import { GameMapImpl } from "../../../src/core/game/GameMap";

describe("GameMap Edge Wrapping", () => {
  // Create a simple 10x5 test map
  const width = 10;
  const height = 5;
  const terrainData = new Uint8Array(width * height);

  // Set all tiles as land (bit 7 = 1)
  for (let i = 0; i < terrainData.length; i++) {
    terrainData[i] = 1 << 7; // IS_LAND_BIT
  }

  const gameMap = new GameMapImpl(width, height, terrainData, width * height);

  describe("neighbors()", () => {
    test("left edge wraps to right edge", () => {
      // Get tile at left edge (x=0, y=2)
      const leftEdgeTile = gameMap.ref(0, 2);
      const neighbors = gameMap.neighbors(leftEdgeTile);

      // Should include tile at right edge (x=9, y=2)
      const rightEdgeTile = gameMap.ref(9, 2);
      expect(neighbors).toContain(rightEdgeTile);
    });

    test("right edge wraps to left edge", () => {
      // Get tile at right edge (x=9, y=2)
      const rightEdgeTile = gameMap.ref(9, 2);
      const neighbors = gameMap.neighbors(rightEdgeTile);

      // Should include tile at left edge (x=0, y=2)
      const leftEdgeTile = gameMap.ref(0, 2);
      expect(neighbors).toContain(leftEdgeTile);
    });

    test("top-left corner has 3 neighbors including wrap", () => {
      // Get tile at top-left corner (x=0, y=0)
      const cornerTile = gameMap.ref(0, 0);
      const neighbors = gameMap.neighbors(cornerTile);

      // Should have exactly 3 neighbors (no north, but wraps east)
      // East (x=1, y=0), South (x=0, y=1), West wrapped to (x=9, y=0)
      expect(neighbors.length).toBe(3);
      expect(neighbors).toContain(gameMap.ref(1, 0)); // East
      expect(neighbors).toContain(gameMap.ref(0, 1)); // South
      expect(neighbors).toContain(gameMap.ref(9, 0)); // West (wrapped)
    });

    test("top-right corner has 3 neighbors including wrap", () => {
      // Get tile at top-right corner (x=9, y=0)
      const cornerTile = gameMap.ref(9, 0);
      const neighbors = gameMap.neighbors(cornerTile);

      // Should have exactly 3 neighbors (no north, but wraps west)
      // West (x=8, y=0), South (x=9, y=1), East wrapped to (x=0, y=0)
      expect(neighbors.length).toBe(3);
      expect(neighbors).toContain(gameMap.ref(8, 0)); // West
      expect(neighbors).toContain(gameMap.ref(9, 1)); // South
      expect(neighbors).toContain(gameMap.ref(0, 0)); // East (wrapped)
    });

    test("middle tile has 4 neighbors without wrap", () => {
      // Get tile in middle (x=5, y=2)
      const middleTile = gameMap.ref(5, 2);
      const neighbors = gameMap.neighbors(middleTile);

      // Should have exactly 4 neighbors (all cardinal directions)
      expect(neighbors.length).toBe(4);
      expect(neighbors).toContain(gameMap.ref(5, 1)); // North
      expect(neighbors).toContain(gameMap.ref(5, 3)); // South
      expect(neighbors).toContain(gameMap.ref(4, 2)); // West
      expect(neighbors).toContain(gameMap.ref(6, 2)); // East
    });
  });

  describe("manhattanDist()", () => {
    test("calculates wrapped distance across left-right edges", () => {
      // Distance from (x=1, y=2) to (x=9, y=2)
      const tile1 = gameMap.ref(1, 2);
      const tile2 = gameMap.ref(9, 2);

      // Direct distance: 8, wrapped distance: 2 (1 to 0, wrap to 9)
      const dist = gameMap.manhattanDist(tile1, tile2);
      expect(dist).toBe(2);
    });

    test("calculates normal distance when wrapping is not shorter", () => {
      // Distance from (x=2, y=2) to (x=5, y=2)
      const tile1 = gameMap.ref(2, 2);
      const tile2 = gameMap.ref(5, 2);

      // Direct distance: 3, wrapped distance: 7
      const dist = gameMap.manhattanDist(tile1, tile2);
      expect(dist).toBe(3);
    });

    test("includes y-axis distance with x-axis wrapping", () => {
      // Distance from (x=1, y=1) to (x=9, y=3)
      const tile1 = gameMap.ref(1, 1);
      const tile2 = gameMap.ref(9, 3);

      // X distance wrapped: 2, Y distance: 2, Total: 4
      const dist = gameMap.manhattanDist(tile1, tile2);
      expect(dist).toBe(4);
    });
  });

  describe("euclideanDistSquared()", () => {
    test("calculates wrapped distance squared across left-right edges", () => {
      // Distance from (x=1, y=2) to (x=9, y=2)
      const tile1 = gameMap.ref(1, 2);
      const tile2 = gameMap.ref(9, 2);

      // X distance wrapped: 2, Y distance: 0
      // Distance squared: 2^2 + 0^2 = 4
      const distSq = gameMap.euclideanDistSquared(tile1, tile2);
      expect(distSq).toBe(4);
    });

    test("calculates normal distance squared when wrapping is not shorter", () => {
      // Distance from (x=2, y=2) to (x=5, y=2)
      const tile1 = gameMap.ref(2, 2);
      const tile2 = gameMap.ref(5, 2);

      // X distance: 3, Y distance: 0
      // Distance squared: 3^2 + 0^2 = 9
      const distSq = gameMap.euclideanDistSquared(tile1, tile2);
      expect(distSq).toBe(9);
    });

    test("includes y-axis distance with x-axis wrapping", () => {
      // Distance from (x=1, y=1) to (x=9, y=3)
      const tile1 = gameMap.ref(1, 1);
      const tile2 = gameMap.ref(9, 3);

      // X distance wrapped: 2, Y distance: 2
      // Distance squared: 2^2 + 2^2 = 8
      const distSq = gameMap.euclideanDistSquared(tile1, tile2);
      expect(distSq).toBe(8);
    });
  });
});
