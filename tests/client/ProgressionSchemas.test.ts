import {
  GameXpResponseSchema,
  ProgressionConfigSchema,
  PublicProgressSchema,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { describe, expect, it } from "vitest";

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
    firstGame: 0,
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

  it("drops a malformed progress object but still parses the profile", () => {
    const parsed = UserMeResponseSchema.safeParse(
      userMe({ progress: { level: "ten" } }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data?.player.progress).toBeUndefined();
    expect(parsed.data?.player.publicId).toBe("abc");
  });

  it("drops a non-object progress value but still parses the profile", () => {
    const parsed = UserMeResponseSchema.safeParse(userMe({ progress: "x" }));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.player.progress).toBeUndefined();
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
      "unverified",
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

  it("reads a breakdown stored under the first XP rules", () => {
    // Rows scored before `played` and `leftEarly` existed lack both.
    const v1: Record<string, unknown> = { ...eligible.breakdown };
    delete v1.played;
    delete v1.leftEarly;
    const parsed = GameXpResponseSchema.parse({ ...eligible, breakdown: v1 });
    if (!parsed.eligible) throw new Error("expected eligible");
    expect(parsed.breakdown).toEqual({
      ...eligible.breakdown,
      played: 0,
      leftEarly: false,
    });
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

describe("provisional XP fields", () => {
  const config = {
    version: 2,
    maxLevel: 100,
    maxPrestige: 10,
    levels: [{ level: 1, xpToNext: 100, cumulativeXp: 0 }],
  };
  const rules = {
    minAliveTicks: 1200,
    gameXp: 50,
    xpPerMinute: 17,
    timeCapMinutes: 30,
    ffaPlacementMax: 150,
    ffaWin: 300,
    fullLobbyHumans: 20,
    teamWin: 150,
    teamWinMinAlivePermille: 500,
    hvnWin: 100,
    firstGameOfDay: 100,
    featXp: 0,
    maxFeatsPerGame: 3,
    publicPermille: 1000,
    rankedPermille: 1250,
    privatePermille: 500,
    singleplayerPermille: 250,
    privateMinHumans: 4,
    privateGamesPerDay: 10,
    singleplayerGamesPerDay: 5,
  };

  it("parses the formula revision, its rules and the prestige rewards", () => {
    const data = { ...config, formula: 1, xp: rules, prestige: { caps: 0 } };
    expect(ProgressionConfigSchema.parse(data)).toEqual(data);
  });

  it("keeps the level curve when the rules are malformed", () => {
    const parsed = ProgressionConfigSchema.parse({
      ...config,
      formula: 1,
      xp: { ...rules, gameXp: "fifty" },
    });
    expect(parsed.xp).toBeUndefined();
    expect(parsed.levels).toEqual(config.levels);
  });

  it("reads first-win rules (from before the first game of the day) as absent", () => {
    const firstWinRules: Record<string, number> = {
      ...rules,
      firstWinOfDay: 200,
    };
    delete firstWinRules.firstGameOfDay;
    const parsed = ProgressionConfigSchema.parse({
      ...config,
      formula: 1,
      xp: firstWinRules,
    });
    expect(parsed.xp).toBeUndefined();
    expect(parsed.levels).toEqual(config.levels);
  });

  it("parses today's allowances and the subscriber boost on progress", () => {
    const daily = {
      privateGames: 2,
      singleplayerGames: 0,
      firstGameClaimed: true,
    };
    const parsed = UserMeResponseSchema.parse(
      userMe({ progress: { ...progress, daily, subscriberPermille: 1200 } }),
    );
    expect(parsed.player.progress?.daily).toEqual(daily);
    expect(parsed.player.progress?.subscriberPermille).toBe(1200);
  });

  it("drops a first-win allowance block but keeps the progress", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({
        progress: {
          ...progress,
          daily: {
            privateGames: 0,
            singleplayerGames: 0,
            firstWinClaimed: true,
          },
        },
      }),
    );
    expect(parsed.player.progress?.level).toBe(37);
    expect(parsed.player.progress?.daily).toBeUndefined();
  });

  it("drops a malformed allowance block but keeps the progress", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({ progress: { ...progress, daily: { privateGames: "x" } } }),
    );
    expect(parsed.player.progress?.level).toBe(37);
    expect(parsed.player.progress?.daily).toBeUndefined();
  });
});
