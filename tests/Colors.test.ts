import { Colord, colord } from "colord";
import {
  ColorAllocator,
  selectDistinctColorIndex,
} from "../src/core/configuration/ColorAllocator";
import {
  blue,
  botColor,
  green,
  orange,
  purple,
  red,
  teal,
  yellow,
} from "../src/core/configuration/Colors";
import { ColoredTeams } from "../src/core/game/Game";

const mockColors: Colord[] = [
  colord({ b: 0, g: 0, r: 255 }),
  colord({ b: 0, g: 255, r: 0 }),
  colord({ b: 255, g: 0, r: 0 }),
];

const fallbackMockColors: Colord[] = [
  colord({ b: 0, g: 0, r: 0 }),
  colord({ b: 255, g: 255, r: 255 }),
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

  test("assignTeamColor returns the base color from the team", () => {
    expect(allocator.assignTeamColor(ColoredTeams.Blue)).toEqual(blue);
    expect(allocator.assignTeamColor(ColoredTeams.Red)).toEqual(red);
    expect(allocator.assignTeamColor(ColoredTeams.Teal)).toEqual(teal);
    expect(allocator.assignTeamColor(ColoredTeams.Purple)).toEqual(purple);
    expect(allocator.assignTeamColor(ColoredTeams.Yellow)).toEqual(yellow);
    expect(allocator.assignTeamColor(ColoredTeams.Orange)).toEqual(orange);
    expect(allocator.assignTeamColor(ColoredTeams.Green)).toEqual(green);
    expect(allocator.assignTeamColor(ColoredTeams.Bot)).toEqual(botColor);
  });

  test("assignTeamPlayerColor always returns the same color for the same playerID", () => {
    const playerId = "player123";

    const blueColor1 = allocator.assignTeamPlayerColor(
      ColoredTeams.Blue,
      playerId,
    );
    const blueColor2 = allocator.assignTeamPlayerColor(
      ColoredTeams.Blue,
      playerId,
    );

    expect(blueColor1.isEqual(blueColor2)).toBe(true);

    const redColor1 = allocator.assignTeamPlayerColor(
      ColoredTeams.Red,
      playerId,
    );
    const redColor2 = allocator.assignTeamPlayerColor(
      ColoredTeams.Red,
      playerId,
    );

    expect(redColor1.isEqual(redColor2)).toBe(true);
  });

  test("assignTeamPlayerColor returns a different color when the playerID is different", () => {
    const playerIdOne = "player1";
    const playerIdTwo = "player2";

    const blueColorPlayerOne = allocator.assignTeamPlayerColor(
      ColoredTeams.Blue,
      playerIdOne,
    );
    const blueColorPlayerTwo = allocator.assignTeamPlayerColor(
      ColoredTeams.Blue,
      playerIdTwo,
    );

    expect(blueColorPlayerOne.isEqual(blueColorPlayerTwo)).toBe(false);

    const redColorPlayerOne = allocator.assignTeamPlayerColor(
      ColoredTeams.Red,
      playerIdOne,
    );
    const redColorPlayerTwo = allocator.assignTeamPlayerColor(
      ColoredTeams.Red,
      playerIdTwo,
    );

    expect(redColorPlayerOne.isEqual(redColorPlayerTwo)).toBe(false);
  });
});

describe("selectDistinctColor", () => {
  test("returns the most distant color", () => {
    const assignedColors = [colord({ b: 0, g: 0, r: 255 })]; // bright red
    const availableColors = [
      colord({ b: 1, g: 1, r: 254 }), // too close
      colord({ b: 0, g: 255, r: 0 }), // distinct green
      colord({ b: 255, g: 0, r: 0 }), // distinct blue
    ];

    const result = selectDistinctColorIndex(availableColors, assignedColors);
    expect(result).not.toBeNull();
    const rgb = availableColors[result!].toRgb();
    expect([
      { a: 1, b: 0, g: 255, r: 0 },
      { a: 1, b: 255, g: 0, r: 0 },
    ]).toContainEqual(rgb);
  });
});
