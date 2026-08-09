import { colord, Colord } from "colord";
import colorblindThemeJson from "../src/client/render/gl/colorblind-theme.json";
import defaultTheme from "../src/client/render/gl/default-theme.json";
import { createThemeSettings } from "../src/client/render/gl/RenderSettings";
import {
  ColorAllocator,
  selectDistinctColorIndex,
} from "../src/client/theme/ColorAllocator";
import { generateCandidateColors } from "../src/client/theme/ColorGenerator";
import {
  observerViews,
  parseObservers,
  simulate,
} from "../src/client/theme/ColorVision";
import { SettingsTheme } from "../src/client/theme/ThemeProvider";
import { PlayerView } from "../src/client/view";
import { ColoredTeams, PlayerType } from "../src/core/game/Game";

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

describe("ColorVision", () => {
  test("normal vision returns the colour unchanged", () => {
    expect(simulate(colord("#a3e635"), "normal").toHex()).toBe("#a3e635");
  });

  test("simulates dichromacy against published reference values", () => {
    // Machado et al. (2009) severity-1.0 matrices applied to linear-light sRGB.
    expect(simulate(colord("#ff0000"), "protan").toHex()).toBe("#6d5f00");
    expect(simulate(colord("#ff0000"), "deutan").toHex()).toBe("#a39000");
    expect(simulate(colord("#0000ff"), "tritan").toHex()).toBe("#006b96");
  });

  test("achromatic colours are unaffected by any deficiency", () => {
    for (const observer of ["protan", "deutan", "tritan"] as const) {
      expect(simulate(colord("#ffffff"), observer).toHex()).toBe("#ffffff");
      expect(simulate(colord("#000000"), observer).toHex()).toBe("#000000");
    }
  });

  test("collapses a pair the default palette treats as distinct", () => {
    // #a3e635 and #fbbf24 are both in default-theme.json humanColors and are
    // clearly different to normal vision, but converge under deuteranopia.
    const a = colord("#a3e635");
    const b = colord("#fbbf24");
    expect(a.delta(b) * 100).toBeGreaterThan(20);
    expect(
      simulate(a, "deutan").delta(simulate(b, "deutan")) * 100,
    ).toBeLessThan(5);
  });

  test("parseObservers narrows valid names", () => {
    expect(parseObservers(["normal", "deutan"])).toEqual(["normal", "deutan"]);
  });

  test("parseObservers rejects an unknown name", () => {
    expect(() => parseObservers(["normal", "deutran"])).toThrow(/deutran/);
  });

  test("parseObservers rejects an empty list", () => {
    expect(() => parseObservers([])).toThrow();
  });

  test("observerViews returns one view per observer, in order", () => {
    const views = observerViews(colord("#ff0000"), ["normal", "deutan"]);
    expect(views).toHaveLength(2);
    expect(views[0].toHex()).toBe("#ff0000");
    expect(views[1].toHex()).toBe("#a39000");
  });
});

describe("ColorGenerator", () => {
  test("produces a substantial candidate set", () => {
    expect(generateCandidateColors().length).toBeGreaterThan(500);
  });

  test("contains no duplicate colours", () => {
    const colors = generateCandidateColors();
    const hexes = new Set(colors.map((c) => c.toHex()));
    expect(hexes.size).toBe(colors.length);
  });

  test("is deterministic across calls", () => {
    const a = generateCandidateColors().map((c) => c.toHex());
    const b = generateCandidateColors().map((c) => c.toHex());
    expect(a).toEqual(b);
  });

  test("avoids near-black and near-white fills", () => {
    for (const color of generateCandidateColors()) {
      const lightness = color.toLch().l;
      expect(lightness).toBeGreaterThan(20);
      expect(lightness).toBeLessThan(95);
    }
  });
});

describe("ColorAllocator distinctness guarantees", () => {
  const humanColors = defaultTheme.humanColors.map((c) => colord(c));
  const fallbackPalette = defaultTheme.fallbackColors.map((c) => colord(c));
  const observers = ["normal", "deutan", "protan"] as const;

  const allocate = (count: number, floor: number) => {
    const allocator = new ColorAllocator(humanColors, fallbackPalette, {
      observers: [...observers],
      distinctnessFloor: floor,
    });
    return Array.from({ length: count }, (_, i) =>
      allocator.assignColor(`player_${i}`),
    );
  };

  const worstSeparation = (colors: Colord[]) => {
    let worst = Infinity;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        for (const observer of observers) {
          const d =
            simulate(colors[i], observer).delta(simulate(colors[j], observer)) *
            100;
          if (d < worst) worst = d;
        }
      }
    }
    return worst;
  };

  test("never issues the same colour twice in a full lobby", () => {
    // MAX_PLAYER_COUNT is 125 (src/server/MapPlaylist.ts) against a 63-colour
    // pool, so a full public lobby exhausts the palette by design.
    const colors = allocate(125, 5);
    expect(new Set(colors.map((c) => c.toHex())).size).toBe(125);
  });

  test("honours the distinctness floor while candidates remain", () => {
    expect(worstSeparation(allocate(48, 5))).toBeGreaterThanOrEqual(5);
  });

  test("generates no new colours for a 48-player game", () => {
    // Everything up to this size comes from palette data shipped in the theme
    // JSON, so lobbies of ordinary size keep the game's existing look — only
    // which colour a given player receives changes.
    const shipped = new Set([
      ...defaultTheme.humanColors.map((c) => colord(c).toHex()),
      ...defaultTheme.fallbackColors.map((c) => colord(c).toHex()),
    ]);
    for (const color of allocate(48, 5)) {
      expect(shipped.has(color.toHex())).toBe(true);
    }
  });

  test("separates a full lobby well past the just-noticeable threshold", () => {
    // The shipped allocator scores 0.00 here — two players share a colour.
    expect(worstSeparation(allocate(125, 5))).toBeGreaterThan(2.3);
  });

  test("is deterministic for the same id sequence", () => {
    expect(allocate(40, 5).map((c) => c.toHex())).toEqual(
      allocate(40, 5).map((c) => c.toHex()),
    );
  });

  test("recycle policy reuses the palette instead of generating", () => {
    const pool = [colord("#ff0000"), colord("#00ff00"), colord("#0000ff")];
    const allocator = new ColorAllocator(pool, [], {
      onExhausted: "recycle",
    });
    const assigned = Array.from({ length: 6 }, (_, i) =>
      allocator.assignColor(`bot_${i}`),
    );
    const palette = new Set(pool.map((c) => c.toHex()));
    for (const color of assigned) {
      expect(palette.has(color.toHex())).toBe(true);
    }
  });

  test("generate policy leaves the palette once it is exhausted", () => {
    const pool = [colord("#ff0000"), colord("#00ff00"), colord("#0000ff")];
    const allocator = new ColorAllocator(pool, [], {});
    const assigned = Array.from({ length: 6 }, (_, i) =>
      allocator.assignColor(`player_${i}`),
    );
    expect(new Set(assigned.map((c) => c.toHex())).size).toBe(6);
  });
});

describe("theme colour settings", () => {
  test("both themes declare observers and a distinctness floor", () => {
    for (const theme of [defaultTheme, colorblindThemeJson]) {
      expect(parseObservers(theme.observers)).toEqual(theme.observers);
      expect(theme.distinctnessFloor).toBeGreaterThan(0);
    }
  });

  test("the colorblind theme checks tritanopia and the default theme does not", () => {
    expect(colorblindThemeJson.observers).toContain("tritan");
    expect(defaultTheme.observers).not.toContain("tritan");
  });

  test("no palette contains a duplicate colour", () => {
    for (const theme of [defaultTheme, colorblindThemeJson]) {
      for (const palette of [
        theme.humanColors,
        theme.nationColors,
        theme.botColors,
        theme.fallbackColors,
      ]) {
        const normalised = palette.map((c) => colord(c).toHex());
        expect(new Set(normalised).size).toBe(normalised.length);
      }
    }
  });
});

describe("SettingsTheme allocator wiring", () => {
  const playerStub = (id: string, type: PlayerType) =>
    ({
      id: () => id,
      team: () => null,
      type: () => type,
    }) as unknown as PlayerView;

  test("bots reuse their palette rather than generating new colours", () => {
    const theme = new SettingsTheme(createThemeSettings("default"));
    const palette = new Set(
      createThemeSettings("default").botColors.map((c) => colord(c).toHex()),
    );
    for (let i = 0; i < 120; i++) {
      const color = theme.territoryColor(
        playerStub(`bot_${i}`, PlayerType.Bot),
      );
      expect(palette.has(color.toHex())).toBe(true);
    }
  });

  test("humans in a full lobby all receive different colours", () => {
    const theme = new SettingsTheme(createThemeSettings("default"));
    const seen = new Set<string>();
    for (let i = 0; i < 125; i++) {
      seen.add(
        theme
          .territoryColor(playerStub(`human_${i}`, PlayerType.Human))
          .toHex(),
      );
    }
    expect(seen.size).toBe(125);
  });
});
