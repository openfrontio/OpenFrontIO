import { colord, Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
import colorblindTheme from "../src/client/render/gl/colorblind-theme.json";
import defaultTheme from "../src/client/render/gl/default-theme.json";
import { createThemeSettings } from "../src/client/render/gl/RenderSettings";
import {
  ColorAllocator,
  selectDistinctColorIndex,
} from "../src/client/theme/ColorAllocator";
import { SettingsTheme } from "../src/client/theme/ThemeProvider";
import type { PlayerView } from "../src/client/view/PlayerView";
import { ColoredTeams, PlayerType } from "../src/core/game/Game";

extend([labPlugin, lchPlugin]);

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

// Tribes (bots) must be tellable from nations by territory color alone
// (#4845). Colors are allocated through the runtime path
// (SettingsTheme.territoryColor -> per-type allocator) rather than read off
// the theme JSON, so the type dispatch is covered too. Drawing more players
// than any pool holds exercises the full pool plus the recycling path.
describe.each(["default", "colorblind"] as const)(
  "tribe vs nation territory colors — %s theme",
  (themeName) => {
    // territoryColor() only reads team/type/id from the player.
    const player = (type: PlayerType, id: string) =>
      ({
        team: () => null,
        type: () => type,
        id: () => id,
      }) as unknown as PlayerView;

    const assignedColors = (type: PlayerType): Colord[] => {
      const theme = new SettingsTheme(createThemeSettings(themeName));
      return Array.from({ length: 64 }, (_, i) =>
        theme.territoryColor(player(type, `${type}-${i}`)),
      );
    };

    test("bot territory colors are near-neutral so tribes read as gray", () => {
      const chromatic = assignedColors(PlayerType.Bot)
        .filter((c) => c.toLch().c >= 12)
        .map((c) => c.toHex());
      expect(chromatic).toEqual([]);
    });

    test("every nation color is perceptually far from every bot color", () => {
      const bots = assignedColors(PlayerType.Bot);
      const confusable = assignedColors(PlayerType.Nation).flatMap((nation) =>
        bots
          .filter((bot) => nation.delta(bot) <= 0.1)
          .map((bot) => `${nation.toHex()} vs ${bot.toHex()}`),
      );
      expect(confusable).toEqual([]);
    });
  },
);

// Compressing botColors into a narrow near-neutral band (previous test)
// risks reintroducing the same tell-them-apart problem *within* the tribe
// pool. Checked against the raw theme-JSON pool, not the 64-draw runtime
// sample above: past pool exhaustion, ColorAllocator intentionally repeats
// colors (see fallbackColors / >50 random fallback in ColorAllocator.ts),
// so duplicates there are by design, not a palette defect.
describe.each([
  ["default", defaultTheme],
  ["colorblind", colorblindTheme],
] as const)("bot color pool separation — %s theme", (_themeName, theme) => {
  test("every bot color is perceptually distinct from every other bot color", () => {
    const hexes = theme.botColors;
    const confusable: string[] = [];
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        if (colord(hexes[i]).delta(colord(hexes[j])) <= 0.025) {
          confusable.push(`${hexes[i]} vs ${hexes[j]}`);
        }
      }
    }
    expect(confusable).toEqual([]);
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
