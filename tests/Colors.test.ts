import { colord, Colord } from "colord";
import defaultTheme from "../src/client/render/gl/default-theme.json";
import { createThemeSettings } from "../src/client/render/gl/RenderSettings";
import {
  ColorAllocator,
  selectDistinctColorIndex,
} from "../src/client/theme/ColorAllocator";
import { SettingsTheme } from "../src/client/theme/ThemeProvider";
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
});

describe("default theme team colors", () => {
  const teamBase = (team: keyof typeof defaultTheme.teamColors): Colord =>
    colord(defaultTheme.teamColors[team]);

  test("teamColor returns the base color from the theme JSON", () => {
    const theme = new SettingsTheme(createThemeSettings("default"));
    expect(theme.teamColor(ColoredTeams.Blue)).toEqual(teamBase("Blue"));
    expect(theme.teamColor(ColoredTeams.Red)).toEqual(teamBase("Red"));
    expect(theme.teamColor(ColoredTeams.Teal)).toEqual(teamBase("Teal"));
    expect(theme.teamColor(ColoredTeams.Purple)).toEqual(teamBase("Purple"));
    expect(theme.teamColor(ColoredTeams.Yellow)).toEqual(teamBase("Yellow"));
    expect(theme.teamColor(ColoredTeams.Orange)).toEqual(teamBase("Orange"));
    expect(theme.teamColor(ColoredTeams.Green)).toEqual(teamBase("Green"));
    expect(theme.teamColor(ColoredTeams.Bot)).toEqual(teamBase("Bot"));
    expect(theme.teamColor(ColoredTeams.Humans)).toEqual(teamBase("Humans"));
    expect(theme.teamColor(ColoredTeams.Nations)).toEqual(teamBase("Nations"));
  });

  test("teamColorForPlayer is stable for the same playerID", () => {
    const theme = new SettingsTheme(createThemeSettings("default"));
    const a = theme.teamColorForPlayer(ColoredTeams.Blue, "player123");
    const b = theme.teamColorForPlayer(ColoredTeams.Blue, "player123");
    expect(a.isEqual(b)).toBe(true);
  });

  test("teamColorForPlayer differs for different playerIDs", () => {
    const theme = new SettingsTheme(createThemeSettings("default"));
    const a = theme.teamColorForPlayer(ColoredTeams.Blue, "player1");
    const b = theme.teamColorForPlayer(ColoredTeams.Blue, "player2");
    expect(a.isEqual(b)).toBe(false);
  });
});

describe("colorblind theme", () => {
  test("applies a palette distinct from the default theme", () => {
    const defaultTheme = new SettingsTheme(createThemeSettings("default"));
    const colorblind = new SettingsTheme(createThemeSettings("colorblind"));

    // At least one team's base color should differ — the colorblind theme
    // swaps the team palettes for CVD-safe (Okabe-Ito) colors.
    const teams = [
      ColoredTeams.Blue,
      ColoredTeams.Red,
      ColoredTeams.Teal,
      ColoredTeams.Purple,
      ColoredTeams.Yellow,
      ColoredTeams.Orange,
      ColoredTeams.Green,
    ];
    const anyDifferent = teams.some(
      (team) =>
        !defaultTheme.teamColor(team).isEqual(colorblind.teamColor(team)),
    );
    expect(anyDifferent).toBe(true);
  });

  test("scales border lightness relative to the fill", () => {
    const colorblind = new SettingsTheme(createThemeSettings("colorblind"));
    const fill = colord("#0072b2");
    const border = colorblind.borderColor(fill);
    expect(border.toHsl().l).toBeCloseTo(fill.toHsl().l * 0.6, 0);
  });
});

describe("selectDistinctColor", () => {
  test("returns the most distant color", () => {
    const assignedColors = [colord({ r: 255, g: 0, b: 0 })]; // bright red
    const availableColors = [
      colord({ r: 254, g: 1, b: 1 }), // too close
      colord({ r: 0, g: 255, b: 0 }), // distinct green
      colord({ r: 0, g: 0, b: 255 }), // distinct blue
    ];

    const result = selectDistinctColorIndex(availableColors, assignedColors);
    const rgb = availableColors[result].toRgb();
    expect([
      { r: 0, g: 255, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 1 },
    ]).toContainEqual(rgb);
  });
});
