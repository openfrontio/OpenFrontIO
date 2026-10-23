import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it } from "vitest";
import {
  calculateFontSize,
  createGrid,
  findLargestInscribedRectangle,
  largestRectangleInHistogram,
  placeName,
  placeSpawnName,
  Point,
  Rectangle,
} from "../packages/engine/src/game/NameBoxCalculator";
import { setup } from "./util/Setup";

function legacyLargestRectangleInHistogram(widths: number[]): Rectangle {
  const stack: number[] = [];
  let maxArea = 0;
  let largestRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  for (let i = 0; i <= widths.length; i++) {
    const h = i === widths.length ? 0 : widths[i];

    while (stack.length > 0 && h < widths[stack[stack.length - 1]]) {
      const height = widths[stack.pop()!];
      const width = stack.length === 0 ? i : i - stack[stack.length - 1] - 1;

      if (height * width > maxArea) {
        maxArea = height * width;
        largestRect = {
          x: stack.length === 0 ? 0 : stack[stack.length - 1] + 1,
          y: 0,
          width: width,
          height: height,
        };
      }
    }

    stack.push(i);
  }

  return largestRect;
}

function legacyFindLargestInscribedRectangle(grid: boolean[][]): Rectangle {
  const rows = grid[0]?.length ?? 0;
  const cols = grid.length;
  if (rows === 0 || cols === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const heights: number[] = new Array(cols).fill(0);
  let largestRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      heights[col] = grid[col][row] ? heights[col] + 1 : 0;
    }
    const rect = legacyLargestRectangleInHistogram(heights);
    if (rect.width * rect.height > largestRect.width * largestRect.height) {
      largestRect = {
        x: rect.x,
        y: row - rect.height + 1,
        width: rect.width,
        height: rect.height,
      };
    }
  }
  return largestRect;
}

describe("NameBoxCalculator Unit Tests", () => {
  describe("largestRectangleInHistogram", () => {
    it("handles empty and zero-height inputs", () => {
      expect(largestRectangleInHistogram([])).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(largestRectangleInHistogram([0, 0, 0])).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });

    it("handles a single bar", () => {
      expect(largestRectangleInHistogram([7])).toEqual({
        x: 0,
        y: 0,
        width: 1,
        height: 7,
      });
    });

    it("handles uniform plateau", () => {
      expect(largestRectangleInHistogram([4, 4, 4, 4])).toEqual({
        x: 0,
        y: 0,
        width: 4,
        height: 4,
      });
    });

    it("handles strictly ascending and descending bars", () => {
      expect(largestRectangleInHistogram([1, 2, 3, 4, 5])).toEqual({
        x: 2,
        y: 0,
        width: 3,
        height: 3,
      });
      expect(largestRectangleInHistogram([5, 4, 3, 2, 1])).toEqual({
        x: 0,
        y: 0,
        width: 3,
        height: 3,
      });
    });

    it("calculates classic multi-peak histograms", () => {
      expect(largestRectangleInHistogram([2, 1, 5, 6, 2, 3])).toEqual({
        x: 2,
        y: 0,
        width: 2,
        height: 5,
      });
      expect(largestRectangleInHistogram([6, 1, 6])).toEqual({
        x: 0,
        y: 0,
        width: 1,
        height: 6,
      });
    });

    it("respects active length and mutates out parameter", () => {
      const buffer = new Int32Array([4, 4, 99, 99]);
      const out: Rectangle = { x: -1, y: -1, width: -1, height: -1 };
      const res = largestRectangleInHistogram(buffer, 2, out);
      expect(res).toBe(out);
      expect(out).toEqual({ x: 0, y: 0, width: 2, height: 4 });
    });
  });

  describe("findLargestInscribedRectangle", () => {
    it("handles empty grid edge cases", () => {
      expect(findLargestInscribedRectangle(new Uint8Array(0), 0, 0)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(findLargestInscribedRectangle(new Uint8Array(10), 0, 10)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(findLargestInscribedRectangle(new Uint8Array(10), 10, 0)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });

    it("finds rectangle on a solid grid", () => {
      // 4 cols x 3 rows, all 1
      const grid = new Uint8Array(4 * 3).fill(1);
      expect(findLargestInscribedRectangle(grid, 4, 3)).toEqual({
        x: 0,
        y: 0,
        width: 4,
        height: 3,
      });
    });

    it("finds a single isolated tile", () => {
      // 5 cols x 4 rows, only at col 2, row 1
      const grid = new Uint8Array(5 * 4);
      grid[1 * 5 + 2] = 1;
      expect(findLargestInscribedRectangle(grid, 5, 4)).toEqual({
        x: 2,
        y: 1,
        width: 1,
        height: 1,
      });
    });

    it("finds the optimal rectangle in an L-shaped territory", () => {
      // 3 cols x 3 rows:
      // 1 1 0
      // 1 1 0
      // 1 1 1
      const grid = new Uint8Array(9);
      grid[0 * 3 + 0] = 1;
      grid[0 * 3 + 1] = 1;
      grid[1 * 3 + 0] = 1;
      grid[1 * 3 + 1] = 1;
      grid[2 * 3 + 0] = 1;
      grid[2 * 3 + 1] = 1;
      grid[2 * 3 + 2] = 1;

      // Best area: 2 x 3 = 6 at (x=0, y=0)
      expect(findLargestInscribedRectangle(grid, 3, 3)).toEqual({
        x: 0,
        y: 0,
        width: 2,
        height: 3,
      });
    });

    it("handles donut / hollow ring shapes without crossing void", () => {
      // 5 cols x 5 rows ring of 1s with 3x3 hollow center of 0s
      const cols = 5;
      const rows = 5;
      const grid = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r === 0 || r === 4 || c === 0 || c === 4) {
            grid[r * cols + c] = 1;
          }
        }
      }
      const res = findLargestInscribedRectangle(grid, cols, rows);
      // Top or bottom strip is 5x1 (area 5)
      expect(res.width * res.height).toBe(5);
    });

    it("Scenario 1 (Mathematical Equivalence): matches legacy implementation bit-for-bit", () => {
      // Test 10 pseudo-random grids with various patterns
      const sizes = [
        { cols: 5, rows: 5 },
        { cols: 8, rows: 6 },
        { cols: 12, rows: 9 },
        { cols: 20, rows: 15 },
      ];

      for (const { cols, rows } of sizes) {
        const legacyGrid: boolean[][] = Array(cols)
          .fill(null)
          .map(() => Array(rows).fill(false));
        const flatGrid = new Uint8Array(cols * rows);

        // Populate with deterministic pattern
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const isSet = (c * 7 + r * 13) % 5 > 1;
            legacyGrid[c][r] = isSet;
            if (isSet) flatGrid[r * cols + c] = 1;
          }
        }

        const legacyResult = legacyFindLargestInscribedRectangle(legacyGrid);
        const typedResult = findLargestInscribedRectangle(flatGrid, cols, rows);
        const legacyWrapperResult = findLargestInscribedRectangle(legacyGrid);

        expect(typedResult).toEqual(legacyResult);
        expect(legacyWrapperResult).toEqual(legacyResult);
      }
    });
  });

  describe("Scenario 2: Residual Height Buffer Pollution", () => {
    it("ensures back-to-back calculations do not leak leftover cached heights", () => {
      // Run 1: Large solid territory (50x50 all 1s)
      const bigGrid = new Uint8Array(50 * 50).fill(1);
      const res1 = findLargestInscribedRectangle(bigGrid, 50, 50);
      expect(res1).toEqual({ x: 0, y: 0, width: 50, height: 50 });

      // Run 2: Immediately follow with a 10x10 empty territory except a single tile at (0, 0)
      const smallGrid = new Uint8Array(10 * 10);
      smallGrid[0] = 1;
      const res2 = findLargestInscribedRectangle(smallGrid, 10, 10);
      expect(res2).toEqual({ x: 0, y: 0, width: 1, height: 1 });

      // Run 3: Follow with 5x5 empty territory except single tile at bottom-right (4, 4)
      const grid3 = new Uint8Array(5 * 5);
      grid3[4 * 5 + 4] = 1;
      const res3 = findLargestInscribedRectangle(grid3, 5, 5);
      expect(res3).toEqual({ x: 4, y: 4, width: 1, height: 1 });
    });
  });

  describe("Scenario 3: Extreme Aspect Ratio Maps & Dynamic Capacity", () => {
    it("safely computes a 1x1000 vertical strip", () => {
      const cols = 1;
      const rows = 1000;
      const grid = new Uint8Array(cols * rows).fill(1);
      const res = findLargestInscribedRectangle(grid, cols, rows);
      expect(res).toEqual({ x: 0, y: 0, width: 1, height: 1000 });
    });

    it("safely computes a 1000x1 horizontal strip", () => {
      const cols = 1000;
      const rows = 1;
      const grid = new Uint8Array(cols * rows).fill(1);
      const res = findLargestInscribedRectangle(grid, cols, rows);
      expect(res).toEqual({ x: 0, y: 0, width: 1000, height: 1 });
    });

    it("safely grows buffer dynamically for super-wide maps (> 8192)", () => {
      const cols = 10000;
      const rows = 1;
      const grid = new Uint8Array(cols * rows).fill(1);
      const res = findLargestInscribedRectangle(grid, cols, rows);
      expect(res).toEqual({ x: 0, y: 0, width: 10000, height: 1 });
    });
  });

  describe("calculateFontSize", () => {
    it("respects width vs height constraints", () => {
      const rectWide: Rectangle = { x: 0, y: 0, width: 100, height: 10 };
      expect(calculateFontSize(rectWide, "Player")).toBeCloseTo(10 / 3, 2);

      const rectTall: Rectangle = { x: 0, y: 0, width: 10, height: 100 };
      // widthConstrained = (10 / 6) * 2 = 3.33, heightConstrained = 33.33
      expect(calculateFontSize(rectTall, "Player")).toBeCloseTo(3.33, 1);
    });
  });

  describe("placeSpawnName & placeName Integration", () => {
    it("handles placeSpawnName with and without spawnTile", async () => {
      const pInfo = new PlayerInfo("p1", PlayerType.Human, "c1", "p1");
      const game = await setup(
        "plains",
        {},
        [pInfo],
        undefined,
        undefined,
        false,
      );
      const player = game.player("p1");

      // Spawn tile unset
      expect(placeSpawnName(game, player)).toEqual({ x: 0, y: 0, size: 0 });

      // Spawn tile set
      const tile = game.ref(20, 20);
      player.setSpawnTile(tile);
      const res = placeSpawnName(game, player);
      expect(res.size).toBeGreaterThan(0);
      expect(res.x).toBe(20);
      expect(res.y).toBeGreaterThanOrEqual(0);
    });

    it("executes placeName on a real game map", async () => {
      const pInfo = new PlayerInfo("p1", PlayerType.Human, "c1", "p1");
      const game = await setup("plains", {}, [pInfo]);
      const player = game.player("p1");

      // Conquer a small cluster of tiles
      for (let x = 10; x <= 15; x++) {
        for (let y = 10; y <= 15; y++) {
          player.conquer(game.ref(x, y));
        }
      }

      const nameView = placeName(game, player);
      expect(nameView).toBeDefined();
      expect(typeof nameView.x).toBe("number");
      expect(typeof nameView.y).toBe("number");
      expect(typeof nameView.size).toBe("number");
      expect(nameView.size).toBeGreaterThan(0);
      expect(nameView.x).toBeGreaterThanOrEqual(10);
      expect(nameView.y).toBeGreaterThanOrEqual(10);
    });

    it("creates a flat Uint8Array grid from player territory via createGrid", async () => {
      const pInfo = new PlayerInfo("p1", PlayerType.Human, "c1", "p1");
      const game = await setup("plains", {}, [pInfo]);
      const player = game.player("p1");
      player.conquer(game.ref(10, 10));

      const boundingBox: { min: Point; max: Point } = {
        min: { x: 10, y: 10 },
        max: { x: 10, y: 10 },
      };
      const grid = createGrid(game, player, boundingBox, 1);
      expect(grid).toBeInstanceOf(Uint8Array);
      expect(grid.length).toBe(1);
      expect(grid[0]).toBe(1);
    });

    it("safely handles inverted or empty bounding boxes in createGrid", async () => {
      const pInfo = new PlayerInfo("p1", PlayerType.Human, "c1", "p1");
      const game = await setup("plains", {}, [pInfo]);
      const player = game.player("p1");

      const invertedBox: { min: Point; max: Point } = {
        min: { x: 20, y: 20 },
        max: { x: 10, y: 10 },
      };
      const grid = createGrid(game, player, invertedBox, 1);
      expect(grid).toBeInstanceOf(Uint8Array);
      expect(grid.length).toBe(0);
    });

    it("safely handles empty and ragged legacy grid arrays", () => {
      expect(findLargestInscribedRectangle([[]])).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(findLargestInscribedRectangle([[true, false], [true]])).toEqual({
        x: 0,
        y: 0,
        width: 2,
        height: 1,
      });
    });
  });
});
