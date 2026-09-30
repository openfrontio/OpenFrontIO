import { describe, expect, it } from "vitest";
import {
  GameXpResponseSchema,
  ProgressionConfigSchema,
  PublicProgressSchema,
  UserMeResponseSchema,
} from "../../src/core/ApiSchemas";

const progress = {
  prestige: 2,
  level: 37,
  xpInLevel: 120,
  xpForNext: 900,
  lifetimeXp: 123456,
  legend: false,
  canPrestige: false,
};

function userMe(player: Record<string, unknown> = {}) {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "abc",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      ...player,
    },
  };
}

const eligible = {
  gameId: "gABCDEFGHI",
  eligible: true,
  breakdown: {
    leftEarly: false,
    played: 50,
    time: 30,
    placement: 40,
    win: 100,
    firstWin: 0,
    feats: 0,
    subtotal: 220,
    gamePermille: 1250,
    subscriberPermille: 1000,
    total: 275,
  },
  before: { prestige: 0, level: 4, xpInLevel: 300, xpForNext: 400 },
  after: { ...progress, prestige: 0, level: 5, xpInLevel: 175, xpForNext: 450 },
  levelsReached: [{ prestige: 0, level: 5 }],
};

describe("UserMeResponseSchema progress", () => {
  it("parses a response from an API that predates progression", () => {
    const parsed = UserMeResponseSchema.safeParse(userMe());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.player.progress).toBeUndefined();
  });

  it("parses progress when present", () => {
    const parsed = UserMeResponseSchema.parse(userMe({ progress }));
    expect(parsed.player.progress).toEqual(progress);
  });

  it("rejects a malformed progress object rather than guessing", () => {
    const parsed = UserMeResponseSchema.safeParse(
      userMe({ progress: { level: "ten" } }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("GameXpResponseSchema", () => {
  it("parses an eligible result", () => {
    const parsed = GameXpResponseSchema.parse(eligible);
    expect(parsed.eligible).toBe(true);
    if (!parsed.eligible) throw new Error("expected eligible");
    expect(parsed.breakdown.total).toBe(275);
    expect(parsed.levelsReached).toEqual([{ prestige: 0, level: 5 }]);
  });

  it("defaults a missing levelsReached to none", () => {
    const rest: Record<string, unknown> = { ...eligible };
    delete rest.levelsReached;
    const parsed = GameXpResponseSchema.parse(rest);
    if (!parsed.eligible) throw new Error("expected eligible");
    expect(parsed.levelsReached).toEqual([]);
  });

  it("parses every documented ineligible reason", () => {
    for (const reason of [
      "not_spawned",
      "too_short",
      "no_action",
      "custom_settings",
      "too_few_humans",
      "daily_cap",
    ]) {
      const parsed = GameXpResponseSchema.parse({
        gameId: "g",
        eligible: false,
        reason,
      });
      expect(parsed).toEqual({ gameId: "g", eligible: false, reason });
    }
  });

  it("keeps an unknown ineligible reason instead of failing the parse", () => {
    const parsed = GameXpResponseSchema.safeParse({
      gameId: "g",
      eligible: false,
      reason: "something_new_next_year",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an eligible result with no breakdown", () => {
    const parsed = GameXpResponseSchema.safeParse({
      gameId: "g",
      eligible: true,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("public progression schemas", () => {
  it("parses public progress", () => {
    const data = { prestige: 10, level: 100, lifetimeXp: 9e6, legend: true };
    expect(PublicProgressSchema.parse(data)).toEqual(data);
  });

  it("parses the progression config", () => {
    const data = {
      version: 1,
      maxLevel: 100,
      maxPrestige: 10,
      levels: [
        { level: 1, xpToNext: 100, cumulativeXp: 0 },
        { level: 2, xpToNext: 150, cumulativeXp: 100 },
      ],
    };
    expect(ProgressionConfigSchema.parse(data)).toEqual(data);
  });
});
