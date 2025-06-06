import { colord, Colord } from "colord";
import {
  blue,
  botColor,
  ColorAllocator,
  red,
  teal,
} from "../src/core/configuration/Colors";
import { ColoredTeams } from "../src/core/game/Game";

const mockColors: Colord[] = [
  colord({ r: 255, g: 0, b: 0 }),
  colord({ r: 0, g: 255, b: 0 }),
  colord({ r: 0, g: 0, b: 255 }),
];

describe("ColorAllocator", () => {
  let allocator: ColorAllocator;

  beforeEach(() => {
    allocator = new ColorAllocator(mockColors);
  });

  test("returns a unique color for each new ID", () => {
    const c1 = allocator.assignPlayerColor("a");
    const c2 = allocator.assignPlayerColor("b");
    const c3 = allocator.assignPlayerColor("c");

    expect(c1.isEqual(c2)).toBe(false);
    expect(c1.isEqual(c3)).toBe(false);
    expect(c2.isEqual(c3)).toBe(false);
  });

  test("returns the same color for the same ID", () => {
    const c1 = allocator.assignPlayerColor("a");
    const c2 = allocator.assignPlayerColor("a");

    expect(c1.isEqual(c2)).toBe(true);
  });

  test("falls back when colors are exhausted", () => {
    allocator.assignPlayerColor("1");
    allocator.assignPlayerColor("2");
    allocator.assignPlayerColor("3");
    const fallback = allocator.assignPlayerColor("4");

    expect(fallback.toRgb()).toMatchObject({ r: 200, g: 200, b: 200 });
  });

  test("assignBotColor returns deterministic color from botColors", () => {
    const allocator = new ColorAllocator(mockColors);

    const id1 = "bot123";
    const id2 = "bot456";

    const c1 = allocator.assignBotColor(id1);
    const c2 = allocator.assignBotColor(id2);
    const c1Again = allocator.assignBotColor(id1);

    expect(c1.isEqual(c2)).toBe(false);
    expect(c1.isEqual(c1Again)).toBe(true);
  });

  test("assignTeamColor returns the expected static color for known teams", () => {
    const allocator = new ColorAllocator(mockColors);

    expect(allocator.assignTeamColor(ColoredTeams.Blue)).toEqual(blue);
    expect(allocator.assignTeamColor(ColoredTeams.Red)).toEqual(red);
    expect(allocator.assignTeamColor(ColoredTeams.Teal)).toEqual(teal);
    expect(allocator.assignTeamColor(ColoredTeams.Bot)).toEqual(botColor);
  });
});
