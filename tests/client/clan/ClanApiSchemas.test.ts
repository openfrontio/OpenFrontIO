import { describe, expect, it } from "vitest";
import {
  ClanBanSchema,
  ClanGameFilterSchema,
  ClanGamePlayerSchema,
  ClanGameResultSchema,
  ClanGameSchema,
  ClanGamesResponseSchema,
  ClanInfoSchema,
  ClanJoinRequestSchema,
  ClanMemberSchema,
} from "../../../src/core/ClanApiSchemas";

describe("ClanInfoSchema", () => {
  const base = {
    name: "Test Clan",
    tag: "TEST",
    description: "A clan",
    isOpen: true,
  };

  it("accepts valid data with ISO datetime createdAt", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      createdAt: "2024-01-15T12:00:00.000Z",
      memberCount: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-ISO strings for createdAt", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      createdAt: "January 15, 2024",
    });
    expect(result.success).toBe(false);
  });

  it("accepts data without optional createdAt", () => {
    const result = ClanInfoSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts data without optional memberCount", () => {
    const result = ClanInfoSchema.safeParse({
      ...base,
      createdAt: "2024-01-15T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts data with neither createdAt nor memberCount", () => {
    const result = ClanInfoSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toBeUndefined();
      expect(result.data.memberCount).toBeUndefined();
    }
  });
});

describe("ClanMemberSchema", () => {
  it("accepts a valid member with ISO datetime joinedAt", () => {
    const result = ClanMemberSchema.safeParse({
      role: "member",
      joinedAt: "2024-03-01T09:30:00.000Z",
      publicId: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a plain string for joinedAt", () => {
    const result = ClanMemberSchema.safeParse({
      role: "member",
      joinedAt: "last Tuesday",
      publicId: "abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects null publicId", () => {
    const result = ClanMemberSchema.safeParse({
      role: "leader",
      joinedAt: "2024-03-01T09:30:00.000Z",
      publicId: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts stats with total/ffa/team/ranked/1v1 win-loss breakdown", () => {
    const result = ClanMemberSchema.safeParse({
      role: "member",
      joinedAt: "2024-03-01T09:30:00.000Z",
      publicId: "abc123",
      stats: {
        total: { wins: 8, losses: 8 },
        ffa: { wins: 2, losses: 4 },
        team: { wins: 5, losses: 1 },
        hvn: { wins: 0, losses: 0 },
        duos: { wins: 1, losses: 0 },
        trios: { wins: 2, losses: 0 },
        quads: { wins: 2, losses: 1 },
        "2": { wins: 1, losses: 0 },
        "3": { wins: 2, losses: 0 },
        "4": { wins: 2, losses: 1 },
        "5": { wins: 0, losses: 0 },
        "6": { wins: 0, losses: 0 },
        "7": { wins: 0, losses: 0 },
        ranked: { wins: 1, losses: 3 },
        "1v1": { wins: 1, losses: 3 },
      },
    });
    expect(result.success).toBe(true);
  });

  it("treats stats as optional for backwards compatibility", () => {
    const result = ClanMemberSchema.safeParse({
      role: "member",
      joinedAt: "2024-03-01T09:30:00.000Z",
      publicId: "abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stats).toBeUndefined();
    }
  });

  it("rejects stats missing a bucket", () => {
    const result = ClanMemberSchema.safeParse({
      role: "member",
      joinedAt: "2024-03-01T09:30:00.000Z",
      publicId: "abc123",
      stats: {
        ffa: { wins: 1, losses: 1 },
        team: { wins: 1, losses: 1 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ClanJoinRequestSchema", () => {
  it("accepts a valid join request with ISO datetime createdAt", () => {
    const result = ClanJoinRequestSchema.safeParse({
      publicId: "player-xyz",
      createdAt: "2024-06-10T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a plain string for createdAt", () => {
    const result = ClanJoinRequestSchema.safeParse({
      publicId: "player-xyz",
      createdAt: "2024-06-10",
    });
    expect(result.success).toBe(false);
  });
});

describe("ClanBanSchema", () => {
  const validBan = {
    publicId: "player-1",
    bannedBy: "officer-1",
    reason: "spamming",
    createdAt: "2024-06-01T00:00:00.000Z",
  };

  it("accepts a valid ban with reason", () => {
    const result = ClanBanSchema.safeParse(validBan);
    expect(result.success).toBe(true);
  });

  it("accepts a ban with null reason", () => {
    const result = ClanBanSchema.safeParse({ ...validBan, reason: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBeNull();
    }
  });

  it("rejects a ban with missing reason field", () => {
    const result = ClanBanSchema.safeParse({
      publicId: validBan.publicId,
      bannedBy: validBan.bannedBy,
      createdAt: validBan.createdAt,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO string for createdAt", () => {
    const result = ClanBanSchema.safeParse({
      ...validBan,
      createdAt: "June 1 2024",
    });
    expect(result.success).toBe(false);
  });

  it("rejects null bannedBy", () => {
    const result = ClanBanSchema.safeParse({ ...validBan, bannedBy: null });
    expect(result.success).toBe(false);
  });
});

describe("ClanGameResultSchema", () => {
  it.each(["victory", "defeat", "incomplete"])("accepts %s", (value) => {
    expect(ClanGameResultSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unknown result value", () => {
    expect(ClanGameResultSchema.safeParse("win").success).toBe(false);
  });
});

describe("ClanGameFilterSchema", () => {
  it.each(["ffa", "team", "hvn", "ranked"])("accepts %s", (value) => {
    expect(ClanGameFilterSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unknown filter value", () => {
    expect(ClanGameFilterSchema.safeParse("all").success).toBe(false);
  });
});

describe("ClanGamePlayerSchema", () => {
  const validPlayer = {
    publicId: "p1",
    username: "alice",
    won: true,
  };

  it("accepts a valid player", () => {
    expect(ClanGamePlayerSchema.safeParse(validPlayer).success).toBe(true);
  });

  it("rejects when won is not a boolean", () => {
    expect(
      ClanGamePlayerSchema.safeParse({ ...validPlayer, won: "true" }).success,
    ).toBe(false);
  });

  it("rejects when required fields are missing", () => {
    expect(ClanGamePlayerSchema.safeParse({ publicId: "p1" }).success).toBe(
      false,
    );
  });
});

describe("ClanGameSchema", () => {
  const validGame = {
    gameId: "g1",
    start: "2024-06-01T00:00:00.000Z",
    durationSeconds: 1234,
    map: "World",
    mode: "Team",
    playerTeams: "Duos",
    rankedType: "1v1",
    result: "victory" as const,
    totalPlayers: 8,
    clanPlayers: [{ publicId: "p1", username: "alice", won: true }],
  };

  it("accepts a fully-populated game", () => {
    expect(ClanGameSchema.safeParse(validGame).success).toBe(true);
  });

  it("accepts playerTeams: null (FFA / non-team games)", () => {
    const result = ClanGameSchema.safeParse({
      ...validGame,
      playerTeams: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts totalPlayers: null (historical rows)", () => {
    const result = ClanGameSchema.safeParse({
      ...validGame,
      totalPlayers: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a row with map/mode/rankedType/result omitted", () => {
    const minimal = {
      gameId: validGame.gameId,
      start: validGame.start,
      durationSeconds: validGame.durationSeconds,
      playerTeams: validGame.playerTeams,
      totalPlayers: validGame.totalPlayers,
      clanPlayers: validGame.clanPlayers,
    };
    expect(ClanGameSchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects a non-ISO start", () => {
    expect(
      ClanGameSchema.safeParse({ ...validGame, start: "June 1 2024" }).success,
    ).toBe(false);
  });

  it("rejects a negative durationSeconds", () => {
    expect(
      ClanGameSchema.safeParse({ ...validGame, durationSeconds: -1 }).success,
    ).toBe(false);
  });

  it("rejects a negative totalPlayers", () => {
    expect(
      ClanGameSchema.safeParse({ ...validGame, totalPlayers: -1 }).success,
    ).toBe(false);
  });

  it("rejects an unknown result value", () => {
    expect(
      ClanGameSchema.safeParse({ ...validGame, result: "win" }).success,
    ).toBe(false);
  });
});

describe("ClanGamesResponseSchema", () => {
  const validGame = {
    gameId: "g1",
    start: "2024-06-01T00:00:00.000Z",
    durationSeconds: 1234,
    clanPlayers: [{ publicId: "p1", username: "alice", won: true }],
  };

  it("accepts a non-empty page with an opaque cursor", () => {
    // The cursor is contractually opaque (see ClanGamesResponseSchema
    // comment) — use a non-date token to make that explicit.
    const result = ClanGamesResponseSchema.safeParse({
      results: [validGame],
      nextCursor: "opaque-cursor-abc123",
    });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.nextCursor).toBe("opaque-cursor-abc123");
  });

  it("accepts an empty page with a null cursor", () => {
    const result = ClanGamesResponseSchema.safeParse({
      results: [],
      nextCursor: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when nextCursor is missing (must be string or null)", () => {
    const result = ClanGamesResponseSchema.safeParse({ results: [] });
    expect(result.success).toBe(false);
  });

  it("rejects when results is not an array", () => {
    const result = ClanGamesResponseSchema.safeParse({
      results: "not-an-array",
      nextCursor: null,
    });
    expect(result.success).toBe(false);
  });
});
