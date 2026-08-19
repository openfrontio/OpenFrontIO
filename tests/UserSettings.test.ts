import {
  CROWN_KEY,
  EFFECTS_KEY,
  FLAG_KEY,
  LOADOUTS_KEY,
  MAX_LOADOUTS,
  PATTERN_KEY,
  PLAYER_STATS_COLUMNS_KEY,
  TEAM_STATS_COLUMNS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
  getDefaultKeybinds,
} from "../src/core/game/UserSettings";

// UserSettings keeps a static in-memory cache and the active player id; reset
// both so each test reads fresh from the (cleared) localStorage as logged out.
function resetUserSettingsState() {
  localStorage.clear();
  const statics = UserSettings as unknown as {
    cache: Map<string, string | null>;
    playerId: string | null;
  };
  statics.cache.clear();
  statics.playerId = null;
}

describe("UserSettings effect selection", () => {
  beforeEach(resetUserSettingsState);

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

describe("UserSettings cosmetic loadouts", () => {
  beforeEach(resetUserSettingsState);

  function equipSample(s: UserSettings) {
    s.setSelectedPatternName("pattern:stripes:red");
    s.setFlag("flag:owned_flag");
    s.setSelectedCrownName("owned_crown");
    s.setSelectedEffectName("transportShipTrail", "spectrum");
  }

  it("saves the equipped cosmetics under a name", () => {
    const s = new UserSettings();
    equipSample(s);
    expect(s.saveLoadout("main")).toEqual({
      name: "main",
      pattern: "pattern:stripes:red",
      flag: "flag:owned_flag",
      crown: "owned_crown",
      effects: { transportShipTrail: "spectrum" },
    });
    expect(s.getLoadouts().map((loadout) => loadout.name)).toEqual(["main"]);
  });

  it("trims the name and rejects a blank one", () => {
    const s = new UserSettings();
    expect(s.saveLoadout("  main  ")?.name).toBe("main");
    expect(s.saveLoadout("   ")).toBeNull();
    expect(s.getLoadouts()).toHaveLength(1);
  });

  it("saving an existing name replaces it in place", () => {
    const s = new UserSettings();
    equipSample(s);
    s.saveLoadout("main");
    s.saveLoadout("second");
    s.setSelectedCrownName("other_crown");
    s.saveLoadout("main");
    expect(s.getLoadouts().map((loadout) => loadout.name)).toEqual([
      "main",
      "second",
    ]);
    expect(s.getLoadout("main")?.crown).toBe("other_crown");
  });

  it("refuses to save more than MAX_LOADOUTS", () => {
    const s = new UserSettings();
    for (let i = 0; i < MAX_LOADOUTS; i++) s.saveLoadout(`loadout-${i}`);
    expect(s.saveLoadout("one-too-many")).toBeNull();
    expect(s.getLoadouts()).toHaveLength(MAX_LOADOUTS);
  });

  it("applies every slot and clears the ones the loadout left empty", () => {
    const s = new UserSettings();
    equipSample(s);
    s.saveLoadout("main");
    s.unequipAll();
    s.saveLoadout("bare");

    expect(s.applyLoadout("main")).toBe(true);
    expect(s.getSelectedSkinName()).toBeNull();
    expect(localStorage.getItem(PATTERN_KEY)).toBe("pattern:stripes:red");
    expect(s.getFlag()).toBe("flag:owned_flag");
    expect(s.getSelectedCrownName()).toBe("owned_crown");
    expect(s.getSelectedEffects()).toEqual({ transportShipTrail: "spectrum" });

    expect(s.applyLoadout("bare")).toBe(true);
    expect(localStorage.getItem(PATTERN_KEY)).toBeNull();
    expect(s.getFlag()).toBeNull();
    expect(s.getSelectedCrownName()).toBeNull();
    expect(s.getSelectedEffects()).toEqual({});
  });

  it("applying an unknown loadout changes nothing", () => {
    const s = new UserSettings();
    equipSample(s);
    expect(s.applyLoadout("missing")).toBe(false);
    expect(s.getSelectedCrownName()).toBe("owned_crown");
  });

  it("deletes a loadout without touching the equipped cosmetics", () => {
    const s = new UserSettings();
    equipSample(s);
    s.saveLoadout("main");
    s.deleteLoadout("main");
    expect(s.getLoadouts()).toEqual([]);
    expect(localStorage.getItem(LOADOUTS_KEY)).toBeNull();
    expect(s.getSelectedCrownName()).toBe("owned_crown");
  });

  it("unequipAll clears every slot but keeps saved loadouts", () => {
    const s = new UserSettings();
    equipSample(s);
    s.saveLoadout("main");
    s.unequipAll();
    expect(localStorage.getItem(PATTERN_KEY)).toBeNull();
    expect(s.getFlag()).toBeNull();
    expect(s.getSelectedCrownName()).toBeNull();
    expect(s.getSelectedEffects()).toEqual({});
    expect(s.getLoadouts().map((loadout) => loadout.name)).toEqual(["main"]);
  });

  it("emits change events for each slot when applying a loadout", () => {
    const s = new UserSettings();
    equipSample(s);
    s.saveLoadout("main");
    const seen: string[] = [];
    const keys = [PATTERN_KEY, FLAG_KEY, CROWN_KEY, EFFECTS_KEY];
    const listeners = keys.map((key) => {
      const listener = () => seen.push(key);
      window.addEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        listener,
      );
      return { key, listener };
    });
    s.applyLoadout("main");
    for (const { key, listener } of listeners) {
      window.removeEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        listener,
      );
    }
    expect(new Set(seen)).toEqual(new Set(keys));
  });

  it("drops malformed entries and corrupt storage", () => {
    localStorage.setItem(LOADOUTS_KEY, "not json");
    expect(new UserSettings().getLoadouts()).toEqual([]);
    resetUserSettingsState();
    localStorage.setItem(
      LOADOUTS_KEY,
      JSON.stringify([
        { name: "ok", pattern: "pattern:stripes", effects: { a: "b", c: 3 } },
        { pattern: "pattern:stripes" },
        "nope",
      ]),
    );
    expect(new UserSettings().getLoadouts()).toEqual([
      {
        name: "ok",
        pattern: "pattern:stripes",
        flag: null,
        crown: null,
        effects: { a: "b" },
      },
    ]);
  });

  it("scopes loadouts to the logged-in player", () => {
    const s = new UserSettings();
    s.setSelectedCrownName("owned_crown");
    UserSettings.setPlayerId("player-1");
    s.saveLoadout("main");
    expect(localStorage.getItem(`${LOADOUTS_KEY}:player-1`)).not.toBeNull();
    UserSettings.setPlayerId("player-2");
    expect(s.getLoadouts()).toEqual([]);
    UserSettings.setPlayerId("player-1");
    expect(s.getLoadouts().map((loadout) => loadout.name)).toEqual(["main"]);
  });
});

describe("UserSettings stats columns", () => {
  beforeEach(resetUserSettingsState);

  it("returns defaults when nothing is stored", () => {
    // The player table opens with the clan tag shown; a team has no tag.
    expect(new UserSettings().statsColumns("player")).toEqual([
      "clan",
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
      "clan",
      "tiles",
      "gold",
      "maxtroops",
    ]);
  });

  it("falls back to defaults when no valid ids remain", () => {
    localStorage.setItem(PLAYER_STATS_COLUMNS_KEY, JSON.stringify(["bogus"]));
    expect(new UserSettings().statsColumns("player")).toEqual([
      "clan",
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

describe("UserSettings per-player cosmetics (#4955)", () => {
  beforeEach(resetUserSettingsState);

  it("stores a logged-in player's selections under publicId-scoped keys", () => {
    UserSettings.setPlayerId("p1");
    const s = new UserSettings();
    s.setSelectedCrownName("golden");
    s.setFlag("flag:premium");
    expect(localStorage.getItem(`${CROWN_KEY}:p1`)).toBe("golden");
    expect(localStorage.getItem(`${FLAG_KEY}:p1`)).toBe("flag:premium");
    expect(localStorage.getItem(CROWN_KEY)).toBeNull();
    expect(localStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it("restores a player's cosmetics after logout and login", () => {
    UserSettings.setPlayerId("p1");
    const s = new UserSettings();
    s.setSelectedCrownName("golden");
    s.setFlag("flag:premium");
    s.setSelectedPatternName("skin:cool");
    s.setSelectedEffectName("transportShipTrail", "spectrum");

    UserSettings.setPlayerId(null); // logout
    expect(s.getSelectedCrownName()).toBeNull();
    expect(s.getFlag()).toBeNull();
    expect(s.getSelectedSkinName()).toBeNull();
    expect(s.getSelectedEffectName("transportShipTrail")).toBeNull();

    UserSettings.setPlayerId("p1"); // login again
    expect(s.getSelectedCrownName()).toBe("golden");
    expect(s.getFlag()).toBe("flag:premium");
    expect(s.getSelectedSkinName()).toBe("cool");
    expect(s.getSelectedEffectName("transportShipTrail")).toBe("spectrum");
  });

  it("keeps different players' selections separate", () => {
    UserSettings.setPlayerId("p1");
    const s = new UserSettings();
    s.setSelectedCrownName("golden");

    UserSettings.setPlayerId(null);
    UserSettings.setPlayerId("p2");
    expect(s.getSelectedCrownName()).toBeNull();
    s.setSelectedCrownName("silver");

    UserSettings.setPlayerId(null);
    UserSettings.setPlayerId("p1");
    expect(s.getSelectedCrownName()).toBe("golden");
  });

  it("adopts pre-existing bare-key selections on login (legacy migration)", () => {
    // Builds that predate per-player keying wrote selections to bare keys.
    localStorage.setItem(CROWN_KEY, "golden");
    localStorage.setItem(FLAG_KEY, "flag:premium");
    localStorage.setItem(PATTERN_KEY, "skin:cool");
    localStorage.setItem(
      EFFECTS_KEY,
      JSON.stringify({ transportShipTrail: "spectrum" }),
    );

    UserSettings.setPlayerId("p1");
    const s = new UserSettings();
    expect(s.getSelectedCrownName()).toBe("golden");
    expect(s.getFlag()).toBe("flag:premium");
    expect(s.getSelectedSkinName()).toBe("cool");
    expect(s.getSelectedEffectName("transportShipTrail")).toBe("spectrum");

    // Moved, not copied: the logged-out scope no longer has them.
    UserSettings.setPlayerId(null);
    expect(s.getSelectedCrownName()).toBeNull();
    expect(localStorage.getItem(CROWN_KEY)).toBeNull();
  });

  it("a selection made while logged out wins over the stored one on login", () => {
    UserSettings.setPlayerId("p1");
    const s = new UserSettings();
    s.setSelectedCrownName("golden");

    UserSettings.setPlayerId(null);
    // e.g. picked (or purchased via #purchase-completed) before logging in
    s.setSelectedCrownName("silver");

    UserSettings.setPlayerId("p1");
    expect(s.getSelectedCrownName()).toBe("silver");
  });

  it("emits change events under the base key when the player changes", () => {
    const events: (string | null)[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${CROWN_KEY}`,
      listener,
    );
    try {
      UserSettings.setPlayerId("p1"); // nothing stored yet
      new UserSettings().setSelectedCrownName("golden");
      UserSettings.setPlayerId(null); // logout: guest scope is empty
      UserSettings.setPlayerId("p1"); // login: selection restored
      expect(events).toEqual([null, "golden", null, "golden"]);
    } finally {
      window.removeEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${CROWN_KEY}`,
        listener,
      );
    }
  });

  it("does not scope non-cosmetic settings", () => {
    UserSettings.setPlayerId("p1");
    const s = new UserSettings();
    s.setAttackRatio(0.5);
    UserSettings.setPlayerId(null);
    expect(s.attackRatio()).toBe(0.5);
  });

  it("returns default nukeAllianceSafetyDuration of 5 and persists updates", () => {
    const s = new UserSettings();
    expect(s.nukeAllianceSafetyDuration()).toBe(5);

    s.setNukeAllianceSafetyDuration(15);
    expect(s.nukeAllianceSafetyDuration()).toBe(15);

    const s2 = new UserSettings();
    expect(s2.nukeAllianceSafetyDuration()).toBe(15);
  });

  it("clamps values to 0..30 in setNukeAllianceSafetyDuration", () => {
    const s = new UserSettings();
    s.setNukeAllianceSafetyDuration(-5);
    expect(s.nukeAllianceSafetyDuration()).toBe(0);

    s.setNukeAllianceSafetyDuration(45);
    expect(s.nukeAllianceSafetyDuration()).toBe(30);

    s.setNukeAllianceSafetyDuration(12.6);
    expect(s.nukeAllianceSafetyDuration()).toBe(13);
  });

  it("falls back to default 5 for malformed or out-of-range persisted values", () => {
    const s = new UserSettings();
    const invalidValues = [
      "Infinity",
      "-Infinity",
      "NaN",
      "invalid",
      "5.5",
      "-1",
      "31",
      "100",
      "",
    ];

    for (const invalid of invalidValues) {
      localStorage.setItem("settings.nukeAllianceSafetyDuration", invalid);
      const statics = UserSettings as unknown as {
        cache: Map<string, string | null>;
      };
      statics.cache.clear();

      expect(s.nukeAllianceSafetyDuration()).toBe(5);
    }
  });
});

describe("getDefaultKeybinds", () => {
  it("returns all essential keybindings for Windows/Linux", () => {
    const keybinds = getDefaultKeybinds(false);
    expect(keybinds.boxSelectWarships).toBe("ShiftLeft");
    expect(keybinds.resetGfx).toBe("KeyR");
    expect(keybinds.selectAllWarships).toBe("KeyF");
    expect(keybinds.buildMenuModifier).toBe("ControlLeft");
  });

  it("handles Mac-specific modifier keys correctly", () => {
    const macKeybinds = getDefaultKeybinds(true);
    expect(macKeybinds.buildMenuModifier).toBe("MetaLeft");
  });
});
