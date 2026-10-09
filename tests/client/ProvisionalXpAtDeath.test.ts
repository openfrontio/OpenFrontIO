import type { HumanStatsSnapshot } from "@openfront/engine-api/game/GameTypes";
import {
  GameMode,
  GameType,
  HumansVsNations,
} from "@openfront/engine-api/game/GameTypes";
import type {
  GameXpResponse,
  Progress,
  ProgressionConfig,
  XpRules,
} from "@openfront/shared/ApiSchemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { XpGameConfig, XpResult } from "../../src/client/ProvisionalXp";
import {
  buildProvisionalXp,
  loadProvisionalXp,
  projectProgress,
  provisionalXpContext,
  reconcileXp,
} from "../../src/client/ProvisionalXpAtDeath";

// Test inputs, not the API's live tuning: every expectation below is worked
// out from these.
const RULES: XpRules = {
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
  // Feats pay nothing, as the API's defaults have it.
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

// A flat curve, 100 XP a level, so level crossings are easy to read.
function progression(
  overrides: Partial<ProgressionConfig> = {},
): ProgressionConfig {
  return {
    version: 2,
    maxLevel: 100,
    maxPrestige: 10,
    levels: Array.from({ length: 100 }, (_, i) => ({
      level: i + 1,
      xpToNext: i + 1 < 100 ? 100 : 0,
      cumulativeXp: 100 * i,
    })),
    formula: 1,
    xp: RULES,
    flares: [],
    ...overrides,
  };
}

const PROGRESS: Progress = {
  prestige: 0,
  level: 4,
  xpInLevel: 50,
  xpForNext: 100,
  lifetimeXp: 350,
  legend: false,
  canPrestige: false,
};

// Progress as /users/@me sends it: with today's allowances (none used yet)
// and the subscriber boost (none).
const FULL_PROGRESS: Progress = {
  ...PROGRESS,
  daily: {
    day: new Date().toISOString().slice(0, 10),
    privateGames: 0,
    singleplayerGames: 0,
    firstGameClaimed: false,
  },
  subscriberPermille: 1000,
};

const FFA: XpGameConfig = {
  gameType: GameType.Public,
  gameMode: GameMode.FFA,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
};

const TEAM: XpGameConfig = { ...FFA, gameMode: GameMode.Team, playerTeams: 2 };

// An FFA lobby, seen from "me", who died at tick 4000 having attacked once.
function ffaSnapshot(): HumanStatsSnapshot {
  return {
    tick: 6000,
    stats: {
      me: { killedAt: 4000n, attacks: [100n] },
      // Out before me.
      early: { killedAt: 2000n },
      // Out on the same tick: not outlasted.
      sameTick: { killedAt: 4000n },
      // Still standing.
      alive: { attacks: [5n] },
      // Disconnected before I died, and still gone: out when they left.
      quitter: { attacks: [5n] },
      // Disconnected after I died: not outlasted.
      lateQuitter: { attacks: [5n] },
    },
    disconnectedAt: { quitter: 3000, lateQuitter: 5000 },
  };
}

describe("provisionalXpContext", () => {
  it("places an FFA player by the opponents out before them so far", () => {
    const derived = provisionalXpContext({
      snapshot: ffaSnapshot(),
      myClientID: "me",
      config: FFA,
      progress: PROGRESS,
    });
    if (derived === "retry") throw new Error("expected a context");
    expect(derived.ctx).toMatchObject({
      spawnedHumans: 6,
      // `early`, and `quitter` (gone at 3000).
      opponentsOutlasted: 2,
      isWinner: false,
      featCount: 0,
      leftAtTick: null,
      ticks: 6000,
      daily: { privateGames: 0, singleplayerGames: 0, firstGameClaimed: false },
      subscriberPermille: 1000,
    });
    expect(derived.disconnectedOpponents).toBe(1);
  });

  it("waits for the death to show in the stats", () => {
    const snapshot = ffaSnapshot();
    snapshot.stats.me = { attacks: [100n] };
    expect(
      provisionalXpContext({
        snapshot,
        myClientID: "me",
        config: FFA,
        progress: PROGRESS,
      }),
    ).toBe("retry");
  });

  it("takes today's allowances and the subscriber boost from the account", () => {
    const derived = provisionalXpContext({
      snapshot: ffaSnapshot(),
      myClientID: "me",
      config: FFA,
      progress: {
        ...PROGRESS,
        daily: {
          privateGames: 3,
          singleplayerGames: 1,
          firstGameClaimed: true,
        },
        subscriberPermille: 1200,
      },
    });
    if (derived === "retry") throw new Error("expected a context");
    expect(derived.ctx.daily).toEqual({
      privateGames: 3,
      singleplayerGames: 1,
      firstGameClaimed: true,
    });
    expect(derived.ctx.subscriberPermille).toBe(1200);
  });

  it("starts the day afresh once the day the allowances are for has ended", () => {
    const daily = {
      day: "2026-10-02",
      privateGames: 3,
      singleplayerGames: 1,
      firstGameClaimed: true,
    };
    const at = (iso: string) =>
      provisionalXpContext({
        snapshot: ffaSnapshot(),
        myClientID: "me",
        config: FFA,
        progress: { ...PROGRESS, daily },
        now: Date.parse(iso),
      });
    const counted = {
      privateGames: 3,
      singleplayerGames: 1,
      firstGameClaimed: true,
    };
    const dailyAt = (iso: string) => {
      const derived = at(iso);
      if (derived === "retry") throw new Error("expected a context");
      return derived.ctx.daily;
    };
    // Died later the same day: the counts stand.
    expect(dailyAt("2026-10-02T23:55:00Z")).toEqual(counted);
    // The stamp is the server's day, seconds old: a local clock 90 minutes
    // fast past midnight doesn't overrule it (that would show a first-game
    // bonus the server won't pay).
    expect(dailyAt("2026-10-03T00:30:00Z")).toEqual(counted);
    expect(dailyAt("2026-10-03T11:59:59Z")).toEqual(counted);
    // Well into the next day the stamp is plainly from an earlier one: the
    // API starts the new day from none used.
    expect(dailyAt("2026-10-03T12:00:00Z")).toEqual({
      privateGames: 0,
      singleplayerGames: 0,
      firstGameClaimed: false,
    });
  });

  it("reads undated allowances the way that can't overstate the figure", () => {
    const at = (day: string | undefined) => {
      const derived = provisionalXpContext({
        snapshot: ffaSnapshot(),
        myClientID: "me",
        config: FFA,
        progress: {
          ...PROGRESS,
          daily: {
            day,
            privateGames: 3,
            singleplayerGames: 1,
            firstGameClaimed: false,
          },
        },
        now: Date.parse("2026-10-09T09:00:00Z"),
      });
      if (derived === "retry") throw new Error("expected a context");
      return derived.ctx.daily;
    };
    // No stamp, or one that doesn't read as a day: the caps as given, and the
    // first-game bonus not claimed (nor the counts reset, however old).
    for (const day of [undefined, "yesterday", "2026-13-45"]) {
      expect(at(day)).toEqual({
        privateGames: 3,
        singleplayerGames: 1,
        firstGameClaimed: true,
      });
    }
    // Today's stamp: as given, the first game still open.
    expect(at("2026-10-09")).toEqual({
      privateGames: 3,
      singleplayerGames: 1,
      firstGameClaimed: false,
    });
  });
});

describe("buildProvisionalXp", () => {
  function build(
    overrides: Partial<Parameters<typeof buildProvisionalXp>[0]> = {},
  ) {
    return buildProvisionalXp({
      gameId: "game1",
      snapshot: ffaSnapshot(),
      myClientID: "me",
      config: FFA,
      progress: FULL_PROGRESS,
      progression: progression(),
      ...overrides,
    });
  }

  it("scores the FFA death with the API's formula", () => {
    const provisional = build();
    if (provisional === null || provisional === "retry") throw new Error();
    // time: floor(4000 * 17 / 600) = 113; placement: floor(150 * 2 * 6 /
    // (5 * 20)) = 18; the day's first public game: 100.
    expect(provisional.response).toMatchObject({
      gameId: "game1",
      eligible: true,
      breakdown: {
        played: 50,
        time: 113,
        placement: 18,
        win: 0,
        firstGame: 100,
        feats: 0,
        subtotal: 281,
        total: 281,
      },
    });
    expect(provisional.teamWinPending).toBe(false);
    expect(provisional.featsPending).toBe(false);
    expect(provisional.inputs).toMatchObject({
      spawnedHumans: 6,
      opponentsOutlasted: 2,
      disconnectedOpponents: 1,
      aliveTicks: 4000,
    });
  });

  it("projects the bar and lists the levels the figure would cross", () => {
    const provisional = build();
    if (provisional === null || provisional === "retry") throw new Error();
    // 50 + 281 in a 100-XP level: three levels up, 31 into level 7.
    expect(provisional.response).toMatchObject({
      before: { prestige: 0, level: 4, xpInLevel: 50, xpForNext: 100 },
      after: { level: 7, xpInLevel: 31, xpForNext: 100, lifetimeXp: 631 },
      levelsReached: [
        { prestige: 0, level: 5 },
        { prestige: 0, level: 6 },
        { prestige: 0, level: 7 },
      ],
    });
  });

  it("counts the first game of the day only while it is open, in a public game", () => {
    const claimed = build({
      progress: {
        ...FULL_PROGRESS,
        daily: {
          privateGames: 0,
          singleplayerGames: 0,
          firstGameClaimed: true,
        },
      },
    });
    if (claimed === null || claimed === "retry") throw new Error();
    expect(claimed.response).toMatchObject({
      breakdown: { firstGame: 0, subtotal: 181, total: 181 },
    });

    // A private game neither pays it nor uses it up: half of 181, rounded.
    const privateGame = build({
      config: { ...FFA, gameType: GameType.Private },
    });
    if (privateGame === null || privateGame === "retry") throw new Error();
    expect(privateGame.response).toMatchObject({
      breakdown: { firstGame: 0, subtotal: 181, gamePermille: 500, total: 91 },
    });
    expect(privateGame.result).toMatchObject({
      daily: { privateGames: 1, firstGameClaimed: false },
    });

    // Ranked: a public game, so it pays, times the ranked multiplier.
    const ranked = build({ config: { ...FFA, rankedType: "1v1" } });
    if (ranked === null || ranked === "retry") throw new Error();
    expect(ranked.response).toMatchObject({
      breakdown: { firstGame: 100, subtotal: 281, total: 351 },
    });
  });

  it("says feats are added at the end only while they pay XP", () => {
    const paying = build({
      progression: progression({ xp: { ...RULES, featXp: 50 } }),
    });
    if (paying === null || paying === "retry") throw new Error();
    expect(paying.featsPending).toBe(true);
  });

  it("leaves a team game's win pending rather than guessing it", () => {
    const provisional = build({ config: TEAM });
    if (provisional === null || provisional === "retry") throw new Error();
    expect(provisional.teamWinPending).toBe(true);
    expect(provisional.response).toMatchObject({
      eligible: true,
      breakdown: { placement: 0, win: 0, firstGame: 100, total: 263 },
    });
  });

  it("treats Humans vs Nations as a team game", () => {
    const provisional = build({
      config: { ...TEAM, playerTeams: HumansVsNations },
    });
    if (provisional === null || provisional === "retry") throw new Error();
    expect(provisional.teamWinPending).toBe(true);
  });

  it("says why a death earned nothing", () => {
    const snapshot = ffaSnapshot();
    snapshot.stats.me = { killedAt: 4000n };
    const provisional = build({ snapshot });
    if (provisional === null || provisional === "retry") throw new Error();
    expect(provisional.response).toEqual({
      gameId: "game1",
      eligible: false,
      reason: "no_action",
    });
  });

  it("has nothing to show when the rules make the figure no number", () => {
    // The schema allows fullLobbyHumans 0, which divides the placement by
    // zero, on the server as here.
    expect(
      build({
        progression: progression({ xp: { ...RULES, fullLobbyHumans: 0 } }),
      }),
    ).toBeNull();
  });

  it("has nothing to show for another formula revision or without rules", () => {
    expect(build({ progression: progression({ formula: 2 }) })).toBeNull();
    expect(
      build({ progression: progression({ formula: undefined }) }),
    ).toBeNull();
    expect(build({ progression: progression({ xp: undefined }) })).toBeNull();
  });

  it("has nothing to show without the day's allowances or the subscriber boost", () => {
    // Read as a fresh day at 1x, either could overstate the figure.
    expect(
      build({ progress: { ...FULL_PROGRESS, daily: undefined } }),
    ).toBeNull();
    expect(
      build({ progress: { ...FULL_PROGRESS, subscriberPermille: undefined } }),
    ).toBeNull();

    const complete = build({ progress: FULL_PROGRESS });
    if (complete === null || complete === "retry") throw new Error();
    expect(complete.response.eligible).toBe(true);
  });

  it("has nothing to show for a singleplayer game while the API requires the stats vote", () => {
    const singleplayer = { ...FFA, gameType: GameType.Singleplayer };
    expect(
      build({
        config: singleplayer,
        progression: progression({ requireStatsAgreed: true }),
      }),
    ).toBeNull();
    // An API that doesn't say is taken to require it.
    expect(build({ config: singleplayer })).toBeNull();
    // Staging scores unverified games: a figure, at the singleplayer rate.
    const staging = build({
      config: singleplayer,
      progression: progression({ requireStatsAgreed: false }),
    });
    if (staging === null || staging === "retry") throw new Error();
    expect(staging.response).toMatchObject({
      eligible: true,
      breakdown: { firstGame: 0, gamePermille: 250 },
    });
    // A multiplayer game carries the vote, so it still gets a figure.
    expect(
      build({ progression: progression({ requireStatsAgreed: true }) }),
    ).not.toBeNull();
  });

  it("shows a singleplayer figure when the API scores singleplayer", () => {
    const provisional = build({
      config: { ...FFA, gameType: GameType.Singleplayer },
      progression: progression({
        requireStatsAgreed: true,
        scoresSingleplayer: true,
      }),
    });
    if (provisional === null || provisional === "retry") throw new Error();
    expect(provisional.response).toMatchObject({
      eligible: true,
      breakdown: { firstGame: 0, gamePermille: 250 },
    });
  });
});

describe("projectProgress", () => {
  it("stops at the cap, where only lifetime XP grows", () => {
    const projected = projectProgress(
      { ...PROGRESS, level: 99, xpInLevel: 90, prestige: 10 },
      500,
      progression(),
    );
    expect(projected?.after).toMatchObject({
      level: 100,
      xpInLevel: 0,
      xpForNext: 0,
      legend: true,
      canPrestige: false,
    });
    expect(projected?.levelsReached).toEqual([{ prestige: 10, level: 100 }]);
  });

  it("gives up when the config doesn't cover a level it needs", () => {
    expect(
      projectProgress(PROGRESS, 500, progression({ levels: [] })),
    ).toBeNull();
  });
});

describe("reconcileXp", () => {
  const breakdown = {
    leftEarly: false,
    played: 50,
    time: 113,
    placement: 0,
    win: 0,
    firstGame: 0,
    feats: 0,
    subtotal: 163,
    gamePermille: 1000,
    subscriberPermille: 1200,
    total: 196,
  };
  const provisional: XpResult = {
    eligible: true,
    breakdown,
    daily: { privateGames: 0, singleplayerGames: 0, firstGameClaimed: true },
  };
  const server = (b: Partial<typeof breakdown>): GameXpResponse => ({
    gameId: "game1",
    eligible: true,
    breakdown: { ...breakdown, ...b },
    before: { prestige: 0, level: 4, xpInLevel: 50, xpForNext: 100 },
    after: {
      prestige: 0,
      level: 6,
      xpInLevel: 46,
      xpForNext: 100,
      lifetimeXp: 546,
      legend: false,
      canPrestige: false,
    },
    levelsReached: [],
  });

  it("matches when the totals agree", () => {
    expect(reconcileXp(provisional, server({}))).toEqual({
      matched: true,
      differences: [],
      provisionalTotal: 196,
      drift: false,
    });
  });

  it("puts a difference down to the team's win and feats when they explain it", () => {
    // (163 + 150 + 50) * 1.2 = 435.6, rounded half up.
    expect(
      reconcileXp(
        provisional,
        server({
          win: 150,
          feats: 50,
          subtotal: 363,
          total: 436,
        }),
      ),
    ).toEqual({
      matched: false,
      differences: ["team_win", "feats"],
      provisionalTotal: 196,
      drift: false,
    });
  });

  it("puts a first-game difference down to the day's allowances", () => {
    // Shown with the first game (263 * 1.2 = 315.6), scored without it: another
    // public game took it first.
    const withFirstGame: XpResult = {
      eligible: true,
      breakdown: { ...breakdown, firstGame: 100, subtotal: 263, total: 316 },
      daily: { privateGames: 0, singleplayerGames: 0, firstGameClaimed: true },
    };
    expect(reconcileXp(withFirstGame, server({}))).toEqual({
      matched: false,
      differences: ["daily_cap"],
      provisionalTotal: 316,
      drift: false,
    });
  });

  it("flags a difference nothing at the end of the game explains", () => {
    expect(
      reconcileXp(
        provisional,
        server({ time: 120, subtotal: 170, total: 204 }),
      ),
    ).toMatchObject({ matched: false, differences: ["other"], drift: true });
  });

  it("puts a changed multiplier down to the config or the subscription, not drift", () => {
    // The API retuned the game type's multiplier (formula unchanged):
    // 163 * 1.3 * 1.2 = 254.28.
    expect(
      reconcileXp(provisional, server({ gamePermille: 1300, total: 254 })),
    ).toEqual({
      matched: false,
      differences: ["multiplier"],
      provisionalTotal: 196,
      drift: false,
    });
    // The subscription lapsed before the game was scored, and the team won.
    expect(
      reconcileXp(
        provisional,
        server({
          win: 150,
          subtotal: 313,
          subscriberPermille: 1000,
          total: 313,
        }),
      ),
    ).toMatchObject({ differences: ["team_win", "multiplier"], drift: false });
    // A changed multiplier doesn't hide a line that differs unexplained.
    expect(
      reconcileXp(
        provisional,
        server({ time: 120, subtotal: 170, gamePermille: 1300, total: 265 }),
      ),
    ).toMatchObject({ differences: ["multiplier", "other"], drift: true });
  });

  it("puts a lower placement down to an opponent who came back", () => {
    // Placed 18 at death with an opponent disconnected: 181 * 1.2 = 217.2.
    const placed: XpResult = {
      eligible: true,
      breakdown: { ...breakdown, placement: 18, subtotal: 181, total: 217 },
      daily: { privateGames: 0, singleplayerGames: 0, firstGameClaimed: true },
    };
    // They came back, so the server placed 10: 173 * 1.2 = 207.6.
    const scored = server({ placement: 10, subtotal: 173, total: 208 });
    expect(reconcileXp(placed, scored, { disconnectedOpponents: 1 })).toEqual({
      matched: false,
      differences: ["reconnect"],
      provisionalTotal: 217,
      drift: false,
    });
    // With nobody disconnected at death, nothing explains it.
    expect(reconcileXp(placed, scored)).toMatchObject({
      differences: ["other"],
      drift: true,
    });
    // Nor when more than the placement differs.
    expect(
      reconcileXp(
        placed,
        server({ placement: 10, time: 120, subtotal: 180, total: 216 }),
        { disconnectedOpponents: 1 },
      ),
    ).toMatchObject({ differences: ["other"], drift: true });
    // A higher placement on the server isn't a returning opponent either.
    expect(
      reconcileXp(
        placed,
        server({ placement: 30, subtotal: 193, total: 232 }),
        {
          disconnectedOpponents: 1,
        },
      ),
    ).toMatchObject({ differences: ["other"], drift: true });
  });

  it("explains an unverified game and the daily limit without flagging drift", () => {
    expect(
      reconcileXp(provisional, {
        gameId: "game1",
        eligible: false,
        reason: "unverified",
      }),
    ).toMatchObject({ differences: ["unverified"], drift: false });
    expect(
      reconcileXp({ eligible: false, reason: "daily_cap" }, server({})),
    ).toMatchObject({
      differences: ["daily_cap"],
      provisionalTotal: null,
      drift: false,
    });
  });

  it("matches two ineligible figures for the same reason", () => {
    expect(
      reconcileXp(
        { eligible: false, reason: "too_short" },
        { gameId: "game1", eligible: false, reason: "too_short" },
      ),
    ).toMatchObject({ matched: true, drift: false });
  });
});

describe("loadProvisionalXp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks again until the death shows in the stats", async () => {
    vi.useFakeTimers();
    const notYet = ffaSnapshot();
    notYet.stats.me = { attacks: [100n] };
    const humanStats = vi
      .fn<() => Promise<HumanStatsSnapshot>>()
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(ffaSnapshot());
    const pending = loadProvisionalXp({
      gameId: "game1",
      myClientID: "me",
      config: FFA,
      progress: FULL_PROGRESS,
      progression: progression(),
      humanStats,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const provisional = await pending;
    expect(humanStats).toHaveBeenCalledTimes(2);
    expect(provisional?.response.eligible).toBe(true);
  });

  it("has nothing to show when the game doesn't answer", async () => {
    vi.useFakeTimers();
    const pending = loadProvisionalXp({
      gameId: "game1",
      myClientID: "me",
      config: FFA,
      progress: FULL_PROGRESS,
      progression: progression(),
      humanStats: () => new Promise(() => {}),
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBeNull();
  });

  it("doesn't ask the game for a singleplayer death the API won't score", async () => {
    const humanStats = vi.fn<() => Promise<HumanStatsSnapshot>>();
    const provisional = await loadProvisionalXp({
      gameId: "game1",
      myClientID: "me",
      config: { ...FFA, gameType: GameType.Singleplayer },
      progress: FULL_PROGRESS,
      progression: progression({ requireStatsAgreed: true }),
      humanStats,
    });
    expect(provisional).toBeNull();
    expect(humanStats).not.toHaveBeenCalled();
  });
});
