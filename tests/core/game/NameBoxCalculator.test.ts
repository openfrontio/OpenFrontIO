import {
  findLargestInscribedRectangle,
  largestRectangleInHistogram,
  Rectangle,
} from "../../../src/core/game/NameBoxCalculator";

describe("NameBoxCalculator", () => {
  describe("findLargestInscribedRectangle", () => {
    it("should return a 0-area rectangle for an empty grid", () => {
      const grid: boolean[][] = [];
      const expected: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
      expect(findLargestInscribedRectangle(grid)).toEqual(expected);
    });

    it("should return a 0-area rectangle for a grid with an empty row", () => {
      const grid: boolean[][] = [[]];
      const expected: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
      expect(findLargestInscribedRectangle(grid)).toEqual(expected);
    });

    it("should return a 0-area rectangle for a grid with all false values", () => {
      const grid: boolean[][] = [
        [false, false, false],
        [false, false, false],
      ];
      const expected: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
      expect(findLargestInscribedRectangle(grid)).toEqual(expected);
    });

    it("should find the largest rectangle in simple all-true grid", () => {
      const grid: boolean[][] = [
        [true, true],
        [true, true],
      ];
      const expected: Rectangle = { x: 0, y: 0, width: 2, height: 2 };
      expect(findLargestInscribedRectangle(grid)).toEqual(expected);
    });

    it("should find the largest rectangle in a simple case", () => {
      const grid: boolean[][] = [
        [false, false, false],
        [false, false, false],
        [false, true, true],
        [false, true, true],
        [false, true, true],
        [false, true, true],
      ];
      const expected: Rectangle = { x: 2, y: 1, width: 4, height: 2 };
      expect(findLargestInscribedRectangle(grid)).toEqual(expected);
    });
  });

  describe("largestRectangleInHistogram", () => {
    it("should return the largest rectangle for a general case", () => {
      const widths = [2, 1, 5, 6, 2, 3];
      const expected: Rectangle = { x: 2, y: 0, width: 2, height: 5 };
      expect(largestRectangleInHistogram(widths)).toEqual(expected);
    });

    it("should return a zero-sized rectangle for an empty array", () => {
      const widths: number[] = [];
      const expected: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
      expect(largestRectangleInHistogram(widths)).toEqual(expected);
    });

    it("should handle a single bar correctly", () => {
      const widths = [5];
      const expected: Rectangle = { x: 0, y: 0, width: 1, height: 5 };
      expect(largestRectangleInHistogram(widths)).toEqual(expected);
    });

    it("should return the full rectangle when all bars have the same height", () => {
      const widths = [4, 4, 4, 4];
      const expected: Rectangle = { x: 0, y: 0, width: 4, height: 4 };
      expect(largestRectangleInHistogram(widths)).toEqual(expected);
    });

    test("should handle a complex V-shaped histogram", () => {
      const widths = [6, 2, 5, 4, 5, 1, 6];
      const expected: Rectangle = { x: 2, y: 0, width: 3, height: 4 };
      expect(largestRectangleInHistogram(widths)).toEqual(expected);
    });
  });
});
