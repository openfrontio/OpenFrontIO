import { colord, Colord } from "colord";
import {
  blue,
  botColor,
  ColorAllocator,
  red,
  selectDistinctColor,
  teal,
} from "../src/core/configuration/Colors";
import { ColoredTeams } from "../src/core/game/Game";

const mockColors: Colord[] = [
  colord({ r: 255, g: 0, b: 0 }),
  colord({ r: 0, g: 255, b: 0 }),
  colord({ r: 0, g: 0, b: 255 }),
];

const fallbackMockColors: Colord[] = [
  colord({ r: 0, g: 0, b: 0 }),
  colord({ r: 255, g: 255, b: 255 }),
];

const fallbackColors = [...fallbackMockColors, ...mockColors];

describe("ColorAllocator", () => {
  let allocator: ColorAllocator;

  beforeEach(() => {
    allocator = new ColorAllocator(mockColors, fallbackMockColors);
  });

  test("returns a unique color for each new ID", () => {
    const c1 = allocator.assignColor("a");
    const c2 = allocator.assignColor("b");
    const c3 = allocator.assignColor("c");

    expect(c1.isEqual(c2)).toBe(false);
    expect(c1.isEqual(c3)).toBe(false);
    expect(c2.isEqual(c3)).toBe(false);
  });

  test("returns the same color for the same ID", () => {
    const c1 = allocator.assignColor("a");
    const c2 = allocator.assignColor("a");

    expect(c1.isEqual(c2)).toBe(true);
  });

  test("falls back when colors are exhausted", () => {
    allocator.assignColor("1");
    allocator.assignColor("2");
    allocator.assignColor("3");
    const fallback = allocator.assignColor("4");
    const fallback2 = allocator.assignColor("5");

    const match = fallbackColors.some((color) => color.isEqual(fallback));
    expect(match).toBe(true);

    const match2 = fallback.isEqual(fallback2);
    expect(match2).toBe(false);
  });

  test("assignBotColor returns deterministic color from botColors", () => {
    const allocator = new ColorAllocator(mockColors, mockColors);

    const id1 = "bot123";
    const id2 = "bot456";

    const c1 = allocator.assignColor(id1);
    const c2 = allocator.assignColor(id2);
    const c1Again = allocator.assignColor(id1);
    const c2Again = allocator.assignColor(id2);

    expect(c1.isEqual(c1Again)).toBe(true);
    expect(c2.isEqual(c2Again)).toBe(true);
  });

  test("assignTeamColor returns the expected static color for known teams", () => {
    expect(allocator.assignTeamColor(ColoredTeams.Blue)).toEqual(blue);
    expect(allocator.assignTeamColor(ColoredTeams.Red)).toEqual(red);
    expect(allocator.assignTeamColor(ColoredTeams.Teal)).toEqual(teal);
    expect(allocator.assignTeamColor(ColoredTeams.Bot)).toEqual(botColor);
  });
});

describe("selectDistinctColor", () => {
  test("returns a distinct color when one exceeds the delta threshold", () => {
    const assignedColors = [colord({ r: 255, g: 0, b: 0 })]; // bright red
    const availableColors = [
      colord({ r: 254, g: 1, b: 1 }), // too close
      colord({ r: 0, g: 255, b: 0 }), // distinct green
      colord({ r: 0, g: 0, b: 255 }), // distinct blue
    ];

    const result = selectDistinctColor(availableColors, assignedColors, 25);
    expect(result).not.toBeNull();
    const rgb = result!.selectedColor.toRgb();
    expect([
      { r: 0, g: 255, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 },
    ]).toContainEqual(rgb);
  });

  test("returns null if all available colors are too close", () => {
    const assignedColors = [colord({ r: 255, g: 0, b: 0 })];
    const availableColors = [
      colord({ r: 250, g: 5, b: 5 }),
      colord({ r: 245, g: 10, b: 10 }),
    ];

    const result = selectDistinctColor(availableColors, assignedColors, 50);
    expect(result).toBeNull();
  });
});
