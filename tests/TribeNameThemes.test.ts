import { resolveTribeNameData } from "../src/core/execution/utils/TribeNames";
import { GameMapType, PlayerType } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { createRandomName } from "../src/core/Util";

describe("resolveTribeNameData", () => {
  test("returns default theme when called with no arguments", () => {
    const data = resolveTribeNameData();
    expect(data.prefixes.length).toBeGreaterThan(0);
    expect(data.suffixes.length).toBeGreaterThan(0);
    expect(data.customTribes).toBeUndefined();
    // Spot-check that the default theme contains known prefixes.
    expect(data.prefixes).toContain("Roman");
    expect(data.prefixes).toContain("Viking");
    expect(data.suffixes).toContain("Empire");
    expect(data.suffixes).toContain("Kingdom");
  });

  test("returns default theme when called with undefined", () => {
    const data = resolveTribeNameData(undefined);
    expect(data.prefixes.length).toBeGreaterThan(0);
    expect(data.suffixes.length).toBeGreaterThan(0);
  });

  test("returns default theme for a map with no theme or customTribes", () => {
    // Most maps in Maps.gen.ts have no theme/customTribes defined.
    const data = resolveTribeNameData(GameMapType.World);
    expect(data.prefixes.length).toBeGreaterThan(0);
    expect(data.suffixes.length).toBeGreaterThan(0);
    expect(data.customTribes).toBeUndefined();
  });

  test("returns data for every valid GameMapType without throwing", () => {
    for (const mapType of Object.values(GameMapType)) {
      const data = resolveTribeNameData(mapType);
      expect(data.prefixes.length).toBeGreaterThan(0);
      expect(data.suffixes.length).toBeGreaterThan(0);
    }
  });

  test("all default theme prefixes and suffixes are non-empty strings", () => {
    const data = resolveTribeNameData();
    for (const prefix of data.prefixes) {
      expect(prefix.length).toBeGreaterThan(0);
    }
    for (const suffix of data.suffixes) {
      expect(suffix.length).toBeGreaterThan(0);
    }
  });

  test("prefix + suffix combinations produce valid tribe names", () => {
    const data = resolveTribeNameData();
    const random = new PseudoRandom(42);
    for (let i = 0; i < 50; i++) {
      const prefixIndex = random.nextInt(0, data.prefixes.length);
      const suffixIndex = random.nextInt(0, data.suffixes.length);
      const name = `${data.prefixes[prefixIndex]} ${data.suffixes[suffixIndex]}`;
      expect(name.length).toBeGreaterThan(0);
      expect(name).toContain(" ");
    }
  });
});

describe("TribeNameData consistency", () => {
  test("default theme has no duplicate prefixes", () => {
    const data = resolveTribeNameData();
    const unique = new Set(data.prefixes);
    expect(unique.size).toBe(data.prefixes.length);
  });

  test("default theme has no duplicate suffixes", () => {
    const data = resolveTribeNameData();
    const unique = new Set(data.suffixes);
    expect(unique.size).toBe(data.suffixes.length);
  });
});

describe("tribeNameThemes.json", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const themes = require("../src/core/execution/utils/tribeNameThemes.json");

  test("default theme exists", () => {
    expect(themes.default).toBeDefined();
    expect(themes.default.prefixes).toBeInstanceOf(Array);
    expect(themes.default.suffixes).toBeInstanceOf(Array);
  });

  test("all themes have non-empty prefixes and suffixes", () => {
    for (const [, theme] of Object.entries(themes)) {
      const t = theme as { prefixes: string[]; suffixes: string[] };
      expect(t.prefixes.length).toBeGreaterThan(0);
      expect(t.suffixes.length).toBeGreaterThan(0);
    }
  });

  test("all theme entries are non-empty strings", () => {
    for (const [, theme] of Object.entries(themes)) {
      const t = theme as { prefixes: string[]; suffixes: string[] };
      for (const prefix of t.prefixes) {
        expect(prefix.length).toBeGreaterThan(0);
      }
      for (const suffix of t.suffixes) {
        expect(suffix.length).toBeGreaterThan(0);
      }
    }
  });

  test("at least 3 themes are defined", () => {
    expect(Object.keys(themes).length).toBeGreaterThanOrEqual(3);
  });
});

describe("createRandomName (deterministic)", () => {
  test("returns null for non-human players", () => {
    expect(createRandomName("test", PlayerType.Bot)).toBeNull();
  });

  test("returns a deterministic name for human players", () => {
    const name1 = createRandomName("Alice", PlayerType.Human);
    const name2 = createRandomName("Alice", PlayerType.Human);
    expect(name1).toBe(name2);
    expect(name1).toBeTruthy();
    expect(name1).toContain("👤");
  });

  test("different names produce different random names (usually)", () => {
    const name1 = createRandomName("Alice", PlayerType.Human);
    const name2 = createRandomName("Bob", PlayerType.Human);
    // They could theoretically collide, but with 178*66 combinations it's unlikely.
    // We just verify both are valid.
    expect(name1).toBeTruthy();
    expect(name2).toBeTruthy();
  });
});
