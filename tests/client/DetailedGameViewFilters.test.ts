import {
  Duos,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  Quads,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { PublicGameInfo } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FILTER_PROFILE_KEY,
  DEFAULT_FILTERS,
  deleteFilterProfile,
  FILTER_PROFILES_KEY,
  filterAndSortLobbies,
  flattenLobbies,
  hasFilterProfile,
  loadDefaultFilterProfile,
  loadFilterProfiles,
  lobbyFacts,
  LobbyFilters,
  MAX_FILTER_PROFILES,
  normalizeFilters,
  saveDefaultFilterProfile,
  saveFilterProfile,
} from "../../src/client/components/DetailedGameViewFilters";
import { UserSettings } from "../../src/client/UserSettings";

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.World,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    difficulty: "Medium",
    gameMapSize: "Medium",
    donateGold: true,
    donateTroops: true,
    nations: "default",
    bots: 400,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    maxPlayers: 100,
    ...overrides,
  } as GameConfig;
}

function lobby(overrides: Partial<PublicGameInfo> = {}): PublicGameInfo {
  return {
    gameID: "a",
    numClients: 10,
    publicGameType: "ffa",
    gameConfig: config(),
    ...overrides,
  } as PublicGameInfo;
}

function filters(overrides: Partial<LobbyFilters> = {}): LobbyFilters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

describe("lobbyFacts", () => {
  it("reports FFA lobbies with no team layout", () => {
    const facts = lobbyFacts(lobby());
    expect(facts.mode).toBe("ffa");
    expect(facts.source).toBe("public");
    expect(facts.teamConfig).toBeNull();
    expect(facts.teamSize).toBeNull();
  });

  it("derives team count from a named team format", () => {
    const facts = lobbyFacts(
      lobby({
        publicGameType: "team",
        gameConfig: config({
          gameMode: GameMode.Team,
          playerTeams: Quads,
          maxPlayers: 50,
        }),
      }),
    );
    expect(facts.mode).toBe("teams");
    expect(facts.teamConfig).toBe(Quads);
    expect(facts.teamSize).toBe(4);
    expect(facts.teamCount).toBe(12);
  });

  it("derives team size from a numeric team count", () => {
    const facts = lobbyFacts(
      lobby({
        gameConfig: config({
          gameMode: GameMode.Team,
          playerTeams: 5,
          maxPlayers: 100,
        }),
      }),
    );
    expect(facts.teamConfig).toBe("5");
    expect(facts.teamCount).toBe(5);
    expect(facts.teamSize).toBe(20);
  });

  it("treats humans vs nations as its own mode", () => {
    const facts = lobbyFacts(
      lobby({
        gameConfig: config({
          gameMode: GameMode.Team,
          playerTeams: HumansVsNations,
        }),
      }),
    );
    expect(facts.mode).toBe("hvn");
    expect(facts.teamConfig).toBeNull();
  });

  it("marks listed private lobbies as hosted", () => {
    expect(lobbyFacts(lobby({ publicGameType: "hosted" })).source).toBe(
      "hosted",
    );
  });
});

describe("flattenLobbies", () => {
  it("returns every bucket's lobbies", () => {
    const games = {
      ffa: [lobby({ gameID: "a" })],
      team: [lobby({ gameID: "b" }), lobby({ gameID: "c" })],
      hosted: [],
    };
    expect(flattenLobbies(games).map((l) => l.gameID)).toEqual(["a", "b", "c"]);
  });

  it("handles a missing games record", () => {
    expect(flattenLobbies(undefined)).toEqual([]);
  });
});

describe("filterAndSortLobbies", () => {
  const ffa = lobby({ gameID: "ffa1", numClients: 5, startsAt: 300 });
  const teams = lobby({
    gameID: "team1",
    publicGameType: "team",
    numClients: 0,
    startsAt: 100,
    gameConfig: config({
      gameMode: GameMode.Team,
      playerTeams: Duos,
      maxPlayers: 40,
    }),
  });
  const hosted = lobby({
    gameID: "hosted1",
    publicGameType: "hosted",
    numClients: 2,
    startsAt: undefined,
    gameConfig: config({ maxPlayers: 20 }),
  });
  const all = [ffa, teams, hosted];

  it("keeps everything by default", () => {
    expect(filterAndSortLobbies(all, filters())).toHaveLength(3);
  });

  it("orders by soonest countdown, with startless lobbies last", () => {
    const sorted = filterAndSortLobbies(all, filters());
    expect(sorted.map((l) => l.gameID)).toEqual(["team1", "ffa1", "hosted1"]);
  });

  it("keeps the server's queue order for lobbies with no countdown", () => {
    // Ids are deliberately out of alphabetical order: the queue is whatever
    // order the server sent, not something the client re-derives.
    const queued = ["zulu", "alpha", "mike"].map((gameID) =>
      lobby({ gameID, startsAt: undefined }),
    );
    const sorted = filterAndSortLobbies([ffa, ...queued], filters());
    expect(sorted.map((l) => l.gameID)).toEqual([
      "ffa1",
      "zulu",
      "alpha",
      "mike",
    ]);
  });

  it("filters by mode", () => {
    expect(
      filterAndSortLobbies(all, filters({ modes: ["teams"] })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["team1"]);
  });

  it("filters by source", () => {
    expect(
      filterAndSortLobbies(all, filters({ sources: ["hosted"] })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["hosted1"]);
  });

  it("filters by team layout, excluding lobbies without one", () => {
    expect(
      filterAndSortLobbies(all, filters({ teamConfigs: [Duos] })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["team1"]);
  });

  it("hides empty lobbies when asked", () => {
    expect(
      filterAndSortLobbies(all, filters({ hideEmpty: true })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["ffa1", "hosted1"]);
  });

  it("applies joined-player bounds", () => {
    expect(
      filterAndSortLobbies(all, filters({ minJoined: 2, maxJoined: 4 })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["hosted1"]);
  });

  it("applies capacity bounds", () => {
    expect(
      filterAndSortLobbies(all, filters({ maxCapacity: 40 })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["team1", "hosted1"]);
  });

  it("applies team-size bounds, excluding lobbies with no teams", () => {
    expect(
      filterAndSortLobbies(all, filters({ minTeamSize: 2 })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["team1"]);
  });
});

describe("normalizeFilters", () => {
  it("falls back to defaults for junk input", () => {
    expect(normalizeFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters("nope")).toEqual(DEFAULT_FILTERS);
  });

  it("drops unknown values and negative bounds", () => {
    const normalized = normalizeFilters({
      modes: ["ffa", "nope", "ffa"],
      sources: "not-an-array",
      teamConfigs: ["Duos", "99"],
      hideEmpty: "yes",
      minJoined: -5,
      maxJoined: 12.7,
      sort: "bogus",
    });
    expect(normalized.modes).toEqual(["ffa"]);
    expect(normalized.sources).toEqual([]);
    expect(normalized.teamConfigs).toEqual([Duos]);
    expect(normalized.hideEmpty).toBe(false);
    expect(normalized.minJoined).toBeNull();
    expect(normalized.maxJoined).toBe(12);
    // A stored profile from an older build can carry fields the filter set no
    // longer has; they're dropped rather than copied through.
    expect("sort" in normalized).toBe(false);
  });
});

describe("filter profiles", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves, loads and deletes a profile", () => {
    saveFilterProfile("Big teams", filters({ minCapacity: 100 }));
    expect(loadFilterProfiles()["Big teams"].minCapacity).toBe(100);
    deleteFilterProfile("Big teams");
    expect(loadFilterProfiles()).toEqual({});
  });

  it("ignores blank names", () => {
    expect(saveFilterProfile("   ", filters())).toEqual({});
    expect(loadFilterProfiles()).toEqual({});
  });

  it("normalizes profiles read back from storage", () => {
    localStorage.setItem(
      FILTER_PROFILES_KEY,
      JSON.stringify({ broken: { modes: ["nope"], hideEmpty: "nope" } }),
    );
    expect(loadFilterProfiles().broken).toEqual(DEFAULT_FILTERS);
  });

  it("survives unparseable storage", () => {
    localStorage.setItem(FILTER_PROFILES_KEY, "{not json");
    expect(loadFilterProfiles()).toEqual({});
  });

  it("treats a profile named __proto__ as an ordinary name", () => {
    const saved = saveFilterProfile("__proto__", filters({ hideEmpty: true }));
    expect(Object.keys(saved)).toEqual(["__proto__"]);
    expect(saved["__proto__"].hideEmpty).toBe(true);
    // Nothing leaked onto Object.prototype, and the round trip survives.
    expect(({} as Record<string, unknown>).hideEmpty).toBeUndefined();

    const reloaded = loadFilterProfiles();
    expect(hasFilterProfile(reloaded, "__proto__")).toBe(true);
    expect(reloaded["__proto__"].hideEmpty).toBe(true);

    expect(Object.keys(deleteFilterProfile("__proto__"))).toEqual([]);
    expect(loadFilterProfiles()["__proto__"]).toBeUndefined();
  });

  it("does not mistake inherited Object members for saved profiles", () => {
    const profiles = loadFilterProfiles();
    expect(hasFilterProfile(profiles, "toString")).toBe(false);
    expect(profiles["toString"]).toBeUndefined();
    // Deleting a name nobody saved is a no-op, not a write.
    expect(Object.keys(deleteFilterProfile("toString"))).toEqual([]);
  });

  it("caps the number of stored profiles but still overwrites existing ones", () => {
    for (let i = 0; i < MAX_FILTER_PROFILES; i++) {
      saveFilterProfile(`p${i}`, filters());
    }
    const afterOverflow = saveFilterProfile("one too many", filters());
    expect(Object.keys(afterOverflow)).toHaveLength(MAX_FILTER_PROFILES);
    const overwritten = saveFilterProfile("p0", filters({ hideEmpty: true }));
    expect(overwritten.p0.hideEmpty).toBe(true);
  });
});

describe("default filter profile", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is empty until one is chosen", () => {
    const profiles = saveFilterProfile("Big", filters({ minCapacity: 100 }));
    expect(loadDefaultFilterProfile(profiles)).toBe("");
  });

  it("remembers the chosen profile", () => {
    const profiles = saveFilterProfile("Big", filters({ minCapacity: 100 }));
    saveDefaultFilterProfile("Big");
    expect(loadDefaultFilterProfile(profiles)).toBe("Big");
  });

  it("an empty name clears the default", () => {
    const profiles = saveFilterProfile("Big", filters());
    saveDefaultFilterProfile("Big");
    saveDefaultFilterProfile("");
    expect(loadDefaultFilterProfile(profiles)).toBe("");
    expect(localStorage.getItem(DEFAULT_FILTER_PROFILE_KEY)).toBeNull();
  });

  it("ignores a default naming a profile that no longer exists", () => {
    saveFilterProfile("Big", filters());
    saveDefaultFilterProfile("Gone");
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("");
  });

  it("deleting the default profile clears it", () => {
    saveFilterProfile("Big", filters());
    saveDefaultFilterProfile("Big");
    deleteFilterProfile("Big");
    expect(localStorage.getItem(DEFAULT_FILTER_PROFILE_KEY)).toBeNull();
  });

  it("deleting another profile keeps the default", () => {
    saveFilterProfile("Big", filters());
    const profiles = saveFilterProfile("Small", filters());
    saveDefaultFilterProfile("Big");
    deleteFilterProfile("Small");
    expect(loadDefaultFilterProfile(profiles)).toBe("Big");
  });
});

describe("profiles per account", () => {
  beforeEach(() => {
    localStorage.clear();
    UserSettings.setPlayerId(null);
  });

  afterEach(() => {
    UserSettings.setPlayerId(null);
  });

  it("keeps each account's profiles and default separate", () => {
    UserSettings.setPlayerId("rikardo");
    saveFilterProfile("asd", filters({ minCapacity: 100 }));
    saveDefaultFilterProfile("asd");

    UserSettings.setPlayerId("anon");
    expect(loadFilterProfiles()).toEqual({});
    saveFilterProfile("anon", filters({ hideEmpty: true }));
    saveDefaultFilterProfile("anon");
    expect(Object.keys(loadFilterProfiles())).toEqual(["anon"]);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("anon");

    UserSettings.setPlayerId("rikardo");
    expect(Object.keys(loadFilterProfiles())).toEqual(["asd"]);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("asd");
  });

  it("keeps profiles through a logout and login", () => {
    UserSettings.setPlayerId("rikardo");
    saveFilterProfile("asd", filters({ minCapacity: 100 }));
    saveDefaultFilterProfile("asd");

    UserSettings.setPlayerId(null);
    expect(loadFilterProfiles()).toEqual({});

    UserSettings.setPlayerId("rikardo");
    expect(loadFilterProfiles().asd.minCapacity).toBe(100);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("asd");
  });

  it("deleting a profile in one account leaves the other's alone", () => {
    UserSettings.setPlayerId("a");
    saveFilterProfile("same name", filters());
    saveDefaultFilterProfile("same name");
    UserSettings.setPlayerId("b");
    saveFilterProfile("same name", filters());
    saveDefaultFilterProfile("same name");

    deleteFilterProfile("same name");
    expect(loadFilterProfiles()).toEqual({});

    UserSettings.setPlayerId("a");
    expect(Object.keys(loadFilterProfiles())).toEqual(["same name"]);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("same name");
  });

  it("moves profiles saved before this change to the first account that loads", () => {
    saveFilterProfile("old", filters({ minCapacity: 50 }));
    saveDefaultFilterProfile("old");

    UserSettings.setPlayerId("first");
    expect(loadFilterProfiles().old.minCapacity).toBe(50);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("old");

    UserSettings.setPlayerId("second");
    expect(loadFilterProfiles()).toEqual({});
  });

  it("leaves logged-out profiles alone when the account already has its own", () => {
    saveFilterProfile("Big", filters({ minCapacity: 100 }));
    saveDefaultFilterProfile("Big");

    UserSettings.setPlayerId("a");
    // First load adopts the logged-out data; then the account clears its default.
    expect(Object.keys(loadFilterProfiles())).toEqual(["Big"]);
    saveDefaultFilterProfile("");

    UserSettings.setPlayerId(null);
    saveFilterProfile("Guest", filters());
    saveDefaultFilterProfile("Guest");

    UserSettings.setPlayerId("a");
    expect(Object.keys(loadFilterProfiles())).toEqual(["Big"]);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("");

    UserSettings.setPlayerId(null);
    expect(Object.keys(loadFilterProfiles())).toEqual(["Guest"]);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("Guest");
  });

  it("an account with profiles but no default does not take the logged-out default", () => {
    UserSettings.setPlayerId("a");
    saveFilterProfile("Mine", filters());

    UserSettings.setPlayerId(null);
    saveFilterProfile("Big", filters());
    saveDefaultFilterProfile("Big");

    UserSettings.setPlayerId("a");
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("");
    expect(Object.keys(loadFilterProfiles())).toEqual(["Mine"]);
  });

  it("moves the default only together with the profiles it names", () => {
    saveFilterProfile("Big", filters());
    saveDefaultFilterProfile("Big");

    UserSettings.setPlayerId("a");
    // Reading the default first must still bring the profiles along.
    expect(loadDefaultFilterProfile({ Big: filters() })).toBe("Big");
    expect(localStorage.getItem(FILTER_PROFILES_KEY)).toBeNull();
    expect(localStorage.getItem(DEFAULT_FILTER_PROFILE_KEY)).toBeNull();
    expect(Object.keys(loadFilterProfiles())).toEqual(["Big"]);
  });

  it("keeps the logged-out data and retries when moving it fails halfway", () => {
    saveFilterProfile("Big", filters());
    saveDefaultFilterProfile("Big");
    UserSettings.setPlayerId("a");

    const realSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === `${DEFAULT_FILTER_PROFILE_KEY}:a`) {
          throw new Error("quota");
        }
        realSetItem.call(this, key, value);
      });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadFilterProfiles()).toEqual({});
    // Nothing was lost or half-moved.
    expect(localStorage.getItem(FILTER_PROFILES_KEY)).not.toBeNull();
    expect(localStorage.getItem(DEFAULT_FILTER_PROFILE_KEY)).toBe("Big");
    expect(localStorage.getItem(`${FILTER_PROFILES_KEY}:a`)).toBeNull();
    setItem.mockRestore();

    expect(Object.keys(loadFilterProfiles())).toEqual(["Big"]);
    expect(loadDefaultFilterProfile(loadFilterProfiles())).toBe("Big");
  });
});
