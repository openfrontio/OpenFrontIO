import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  deleteFilterProfile,
  FILTER_PROFILES_KEY,
  filterAndSortLobbies,
  flattenLobbies,
  hasFilterProfile,
  loadFilterProfiles,
  lobbyFacts,
  LobbyFilters,
  MAX_FILTER_PROFILES,
  normalizeFilters,
  saveFilterProfile,
} from "../../src/client/components/DetailedViewFilters";
import {
  Duos,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  Quads,
} from "../../src/core/game/Game";
import { GameConfig, PublicGameInfo } from "../../src/core/Schemas";

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

  it("sorts by soonest start, with startless lobbies last", () => {
    const sorted = filterAndSortLobbies(
      all,
      filters({ sort: "starts_soonest" }),
    );
    expect(sorted.map((l) => l.gameID)).toEqual(["team1", "ffa1", "hosted1"]);
  });

  it("sorts by player count in both directions", () => {
    expect(
      filterAndSortLobbies(all, filters({ sort: "players_desc" })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["ffa1", "hosted1", "team1"]);
    expect(
      filterAndSortLobbies(all, filters({ sort: "players_asc" })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["team1", "hosted1", "ffa1"]);
  });

  it("sorts by capacity", () => {
    expect(
      filterAndSortLobbies(all, filters({ sort: "capacity_desc" })).map(
        (l) => l.gameID,
      ),
    ).toEqual(["ffa1", "team1", "hosted1"]);
  });

  it("sorts by map name using the supplied resolver", () => {
    const names: Record<string, string> = {
      ffa1: "Zanzibar",
      team1: "Africa",
      hosted1: "Mena",
    };
    const sorted = filterAndSortLobbies(
      all,
      filters({ sort: "map_asc" }),
      (l) => names[l.gameID],
    );
    expect(sorted.map((l) => l.gameID)).toEqual(["team1", "hosted1", "ffa1"]);
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
    expect(normalized.sort).toBe(DEFAULT_FILTERS.sort);
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
      JSON.stringify({ broken: { modes: ["nope"], sort: 42 } }),
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
