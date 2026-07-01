import {
  PlayerGameModeFilterSchema,
  PlayerGameResultSchema,
  PlayerGameTypeFilterSchema,
  PlayerProfileSchema,
  PublicPlayerGameSchema,
  PublicPlayerGamesResponseSchema,
} from "../src/core/ApiSchemas";

describe("PlayerProfileSchema", () => {
  const base = {
    createdAt: "2024-01-15T12:00:00.000Z",
    stats: {},
  };

  it("accepts a profile without a games array (moved to its own endpoint)", () => {
    const result = PlayerProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("ignores a legacy games field rather than failing the parse", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      games: [{ gameId: "g1" }],
    });
    // Zod strips unknown keys by default, so an old server response that still
    // carries games[] parses cleanly without the field surfacing.
    expect(result.success).toBe(true);
    if (result.success) {
      expect("games" in result.data).toBe(false);
    }
  });

  it("rejects a non-ISO createdAt", () => {
    expect(
      PlayerProfileSchema.safeParse({ ...base, createdAt: "yesterday" })
        .success,
    ).toBe(false);
  });
});

describe("PlayerGameModeFilterSchema", () => {
  it.each(["ffa", "team", "hvn", "ranked"])("accepts %s", (value) => {
    expect(PlayerGameModeFilterSchema.safeParse(value).success).toBe(true);
  });

  it("rejects 'all' (filter omission is encoded by absence, not a value)", () => {
    expect(PlayerGameModeFilterSchema.safeParse("all").success).toBe(false);
  });
});

describe("PlayerGameTypeFilterSchema", () => {
  it.each(["public", "private", "singleplayer"])("accepts %s", (value) => {
    expect(PlayerGameTypeFilterSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unknown type value", () => {
    expect(PlayerGameTypeFilterSchema.safeParse("ranked").success).toBe(false);
  });
});

describe("PlayerGameResultSchema", () => {
  it.each(["victory", "defeat", "incomplete"])("accepts %s", (value) => {
    expect(PlayerGameResultSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unknown result value", () => {
    expect(PlayerGameResultSchema.safeParse("win").success).toBe(false);
  });
});

describe("PublicPlayerGameSchema", () => {
  const validGame = {
    gameId: "g1",
    start: "2024-06-01T00:00:00.000Z",
    durationSeconds: 1234,
    map: "World",
    mode: "Team",
    type: "Public",
    playerTeams: "Duos",
    rankedType: "unranked",
    result: "victory" as const,
    totalPlayers: 8,
    username: "alice",
    clanTag: "ABC",
  };

  it("accepts a fully-populated game", () => {
    expect(PublicPlayerGameSchema.safeParse(validGame).success).toBe(true);
  });

  it("accepts clanTag: null (not repping a clan)", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, clanTag: null }).success,
    ).toBe(true);
  });

  it("rejects a missing username", () => {
    const withoutUsername: Record<string, unknown> = { ...validGame };
    delete withoutUsername.username;
    expect(PublicPlayerGameSchema.safeParse(withoutUsername).success).toBe(
      false,
    );
  });

  it("accepts playerTeams: null (FFA / non-team games)", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, playerTeams: null })
        .success,
    ).toBe(true);
  });

  it("accepts totalPlayers: null (historical rows)", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, totalPlayers: null })
        .success,
    ).toBe(true);
  });

  it("rejects a negative durationSeconds", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, durationSeconds: -1 })
        .success,
    ).toBe(false);
  });

  it("rejects a non-ISO start", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, start: "June 1 2024" })
        .success,
    ).toBe(false);
  });
});

describe("PublicPlayerGamesResponseSchema", () => {
  const validGame = {
    gameId: "g1",
    start: "2024-06-01T00:00:00.000Z",
    durationSeconds: 1234,
    map: "World",
    mode: "Free For All",
    type: "Public",
    playerTeams: null,
    rankedType: "unranked",
    result: "defeat" as const,
    totalPlayers: 20,
    username: "bob",
    clanTag: null,
  };

  it("accepts a non-empty page with an opaque cursor", () => {
    const result = PublicPlayerGamesResponseSchema.safeParse({
      results: [validGame],
      nextCursor: "opaque-cursor-abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nextCursor).toBe("opaque-cursor-abc123");
    }
  });

  it("accepts an empty page with a null cursor", () => {
    expect(
      PublicPlayerGamesResponseSchema.safeParse({
        results: [],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });

  it("rejects when nextCursor is missing (must be string or null)", () => {
    expect(
      PublicPlayerGamesResponseSchema.safeParse({ results: [] }).success,
    ).toBe(false);
  });
});
