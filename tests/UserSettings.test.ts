import {
  EFFECTS_KEY,
  PLAYER_STATS_COLUMNS_KEY,
  TEAM_STATS_COLUMNS_KEY,
  UserSettings,
} from "../src/core/game/UserSettings";

describe("UserSettings effect selection", () => {
  beforeEach(() => {
    localStorage.clear();
    // UserSettings keeps a static in-memory cache; reset it too so each test
    // reads fresh from the (cleared) localStorage.
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("sets and reads a per-effectType selection", () => {
    const s = new UserSettings();
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    expect(s.getSelectedEffectName("transportShipTrail")).toBe("spectrum");
  });

  it("returns null when nothing is selected", () => {
    expect(
      new UserSettings().getSelectedEffectName("transportShipTrail"),
    ).toBeNull();
  });

  it("clearing the last selection removes the storage key", () => {
    const s = new UserSettings();
    s.setSelectedEffectName("transportShipTrail", "spectrum");
    s.setSelectedEffectName("transportShipTrail", undefined);
    expect(s.getSelectedEffectName("transportShipTrail")).toBeNull();
    expect(localStorage.getItem(EFFECTS_KEY)).toBeNull();
  });

  it("clearing one effectType leaves other types intact", () => {
    const s = new UserSettings();
    // Seed two types directly (only one real effectType exists today).
    localStorage.setItem(
      EFFECTS_KEY,
      JSON.stringify({ transportShipTrail: "spectrum", future: "x" }),
    );
    s.setSelectedEffectName("transportShipTrail", undefined);
    expect(s.getSelectedEffects()).toEqual({ future: "x" });
  });

  it("returns an empty map for a corrupt blob", () => {
    localStorage.setItem(EFFECTS_KEY, "not json");
    expect(new UserSettings().getSelectedEffects()).toEqual({});
  });

  it("keeps per-nukeType nuke-explosion slots independent", () => {
    const s = new UserSettings();
    s.setSelectedEffectName("atom", "atom_boom");
    s.setSelectedEffectName("hydro", "hydro_boom");
    expect(s.getSelectedEffectName("atom")).toBe("atom_boom");
    expect(s.getSelectedEffectName("hydro")).toBe("hydro_boom");
    // Clearing one bomb's slot leaves the others intact.
    s.setSelectedEffectName("atom", undefined);
    expect(s.getSelectedEffectName("atom")).toBeNull();
    expect(s.getSelectedEffectName("hydro")).toBe("hydro_boom");
  });
});

describe("UserSettings stats columns", () => {
  beforeEach(() => {
    localStorage.clear();
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  });

  it("returns defaults when nothing is stored", () => {
    expect(new UserSettings().statsColumns("player")).toEqual([
      "tiles",
      "gold",
      "maxtroops",
    ]);
    expect(new UserSettings().statsColumns("team")).toEqual([
      "tiles",
      "gold",
      "maxtroops",
    ]);
  });

  it("round-trips a selection in registry order", () => {
    const s = new UserSettings();
    // Stored order is check order; getter returns registry (display) order.
    s.setStatsColumns("player", ["warships", "gold"]);
    expect(s.statsColumns("player")).toEqual(["gold", "warships"]);
  });

  it("filters unknown ids", () => {
    localStorage.setItem(
      PLAYER_STATS_COLUMNS_KEY,
      JSON.stringify(["gold", "bogus"]),
    );
    expect(new UserSettings().statsColumns("player")).toEqual(["gold"]);
  });

  it("drops the removed attacks column from persisted selections", () => {
    localStorage.setItem(
      PLAYER_STATS_COLUMNS_KEY,
      JSON.stringify(["attacks", "gold"]),
    );
    expect(new UserSettings().statsColumns("player")).toEqual(["gold"]);
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(PLAYER_STATS_COLUMNS_KEY, "not json");
    expect(new UserSettings().statsColumns("player")).toEqual([
      "tiles",
      "gold",
      "maxtroops",
    ]);
  });

  it("falls back to defaults when no valid ids remain", () => {
    localStorage.setItem(PLAYER_STATS_COLUMNS_KEY, JSON.stringify(["bogus"]));
    expect(new UserSettings().statsColumns("player")).toEqual([
      "tiles",
      "gold",
      "maxtroops",
    ]);
  });

  it("keeps player and team selections independent", () => {
    const s = new UserSettings();
    s.setStatsColumns("player", ["gold"]);
    s.setStatsColumns("team", ["warships"]);
    expect(s.statsColumns("player")).toEqual(["gold"]);
    expect(s.statsColumns("team")).toEqual(["warships"]);
    expect(localStorage.getItem(TEAM_STATS_COLUMNS_KEY)).toBe('["warships"]');
  });
});
