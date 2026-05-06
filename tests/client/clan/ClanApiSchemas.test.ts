import { describe, expect, it } from "vitest";
import {
  ClanBanSchema,
  ClanInfoSchema,
  ClanJoinRequestSchema,
  ClanMemberSchema,
  ClanStatsSchema,
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

describe("ClanStatsSchema", () => {
  const validStats = {
    clanTag: "ABcd1",
    games: 10,
    wins: 7,
    losses: 3,
    stats: {
      total: { wins: 7, losses: 3 },
      ffa: { wins: 3, losses: 2 },
      team: { wins: 2, losses: 1 },
      hvn: { wins: 1, losses: 0 },
      ranked: { wins: 1, losses: 0 },
      "1v1": { wins: 1, losses: 0 },
    },
    teamTypeWL: { ffa: { wl: [7, 3] } },
    teamCountWL: { "2": { wl: [4, 1] } },
  };

  it("accepts a valid clan tag (2-5 alphanumeric chars)", () => {
    for (const tag of ["AB", "abc12", "XYZAB"]) {
      const result = ClanStatsSchema.safeParse({ ...validStats, clanTag: tag });
      expect(result.success, `tag "${tag}" should be valid`).toBe(true);
    }
  });

  it("rejects tags that are too short", () => {
    const result = ClanStatsSchema.safeParse({ ...validStats, clanTag: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects tags that are too long", () => {
    const result = ClanStatsSchema.safeParse({
      ...validStats,
      clanTag: "TOOLNG",
    });
    expect(result.success).toBe(false);
  });

  it("rejects tags with non-alphanumeric characters", () => {
    const result = ClanStatsSchema.safeParse({
      ...validStats,
      clanTag: "AB-CD",
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
