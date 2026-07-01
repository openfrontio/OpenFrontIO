import {
  EFFECTS_KEY,
  LEADERBOARD_COLUMNS_KEY,
  UserSettings,
} from "../src/core/game/UserSettings";

const DEFAULT_LEADERBOARD_COLUMNS = ["tiles", "gold", "maxtroops"];

function clearUserSettingsCache(): void {
  (
    UserSettings as unknown as { cache: Map<string, string | null> }
  ).cache.clear();
}

describe("UserSettings effect selection", () => {
  beforeEach(() => {
    localStorage.clear();
    clearUserSettingsCache();
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
});

describe("UserSettings leaderboard columns", () => {
  beforeEach(() => {
    localStorage.clear();
    clearUserSettingsCache();
  });

  it("falls back to defaults for invalid JSON", () => {
    localStorage.setItem(LEADERBOARD_COLUMNS_KEY, "not-json");

    expect(new UserSettings().leaderboardColumns()).toEqual(
      DEFAULT_LEADERBOARD_COLUMNS,
    );
  });

  it("filters unknown keys", () => {
    localStorage.setItem(
      LEADERBOARD_COLUMNS_KEY,
      JSON.stringify(["gold", "unknown", "maxtroops"]),
    );

    expect(new UserSettings().leaderboardColumns()).toEqual([
      "gold",
      "maxtroops",
    ]);
  });

  it("falls back to defaults for empty or fully invalid selections", () => {
    const settings = new UserSettings();

    settings.setLeaderboardColumns([]);
    expect(settings.leaderboardColumns()).toEqual(DEFAULT_LEADERBOARD_COLUMNS);

    clearUserSettingsCache();
    localStorage.setItem(LEADERBOARD_COLUMNS_KEY, JSON.stringify(["unknown"]));
    expect(new UserSettings().leaderboardColumns()).toEqual(
      DEFAULT_LEADERBOARD_COLUMNS,
    );
  });

  it("keeps the last selected column enabled", () => {
    const settings = new UserSettings();

    settings.setLeaderboardColumns(["gold"]);
    expect(settings.toggleLeaderboardColumn("gold")).toEqual(["gold"]);
  });
});
