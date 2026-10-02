import { afterEach, describe, expect, it, vi } from "vitest";
import type { XpGameConfig, XpResult } from "../../src/client/ProvisionalXp";
import {
  buildProvisionalXp,
  loadProvisionalXp,
  projectProgress,
  provisionalXpContext,
  reconcileXp,
} from "../../src/client/ProvisionalXpAtDeath";
import type {
  GameXpResponse,
  Progress,
  ProgressionConfig,
  XpRules,
} from "../../src/core/ApiSchemas";
import { GameMode, GameType, HumansVsNations } from "../../src/core/game/Game";
import type { HumanStatsSnapshot } from "../../src/core/game/HumanStats";

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
  firstWinOfDay: 200,
  featXp: 50,
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
      daily: { privateGames: 0, singleplayerGames: 0, firstWinClaimed: false },
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
        daily: { privateGames: 3, singleplayerGames: 1, firstWinClaimed: true },
        subscriberPermille: 1200,
      },
    });
    if (derived === "retry") throw new Error("expected a context");
    expect(derived.ctx.daily).toEqual({
      privateGames: 3,
      singleplayerGames: 1,
      firstWinClaimed: true,
    });
    expect(derived.ctx.subscriberPermille).toBe(1200);
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
      progress: PROGRESS,
      progression: progression(),
      ...overrides,
    });
  }

  it("scores the FFA death with the API's formula", () => {
    const provisional = build();
    if (provisional === null || provisional === "retry") throw new Error();
    // time: floor(4000 * 17 / 600) = 113; placement: floor(150 * 2 * 6 /
    // (5 * 20)) = 18.
    expect(provisional.response).toMatchObject({
      gameId: "game1",
      eligible: true,
      breakdown: {
        played: 50,
        time: 113,
        placement: 18,
        win: 0,
        firstWin: 0,
        feats: 0,
        subtotal: 181,
        total: 181,
      },
    });
    expect(provisional.teamWinPending).toBe(false);
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
    // 50 + 181 in a 100-XP level: two levels up, 31 into level 6.
    expect(provisional.response).toMatchObject({
      before: { prestige: 0, level: 4, xpInLevel: 50, xpForNext: 100 },
      after: { level: 6, xpInLevel: 31, xpForNext: 100, lifetimeXp: 531 },
      levelsReached: [
        { prestige: 0, level: 5 },
        { prestige: 0, level: 6 },
      ],
    });
  });

  it("leaves a team game's win pending rather than guessing it", () => {
    const provisional = build({ config: TEAM });
    if (provisional === null || provisional === "retry") throw new Error();
    expect(provisional.teamWinPending).toBe(true);
    expect(provisional.response).toMatchObject({
      eligible: true,
      breakdown: { placement: 0, win: 0, firstWin: 0, total: 163 },
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

  it("has nothing to show for another formula revision or without rules", () => {
    expect(build({ progression: progression({ formula: 2 }) })).toBeNull();
    expect(
      build({ progression: progression({ formula: undefined }) }),
    ).toBeNull();
    expect(build({ progression: progression({ xp: undefined }) })).toBeNull();
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
    firstWin: 0,
    feats: 0,
    subtotal: 163,
    gamePermille: 1000,
    subscriberPermille: 1200,
    total: 196,
  };
  const provisional: XpResult = {
    eligible: true,
    breakdown,
    daily: { privateGames: 0, singleplayerGames: 0, firstWinClaimed: false },
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
    // (163 + 150 + 200 + 50) * 1.2 = 675.6, rounded half up.
    expect(
      reconcileXp(
        provisional,
        server({
          win: 150,
          firstWin: 200,
          feats: 50,
          subtotal: 563,
          total: 676,
        }),
      ),
    ).toEqual({
      matched: false,
      differences: ["team_win", "feats"],
      provisionalTotal: 196,
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
      progress: PROGRESS,
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
      progress: PROGRESS,
      progression: progression(),
      humanStats: () => new Promise(() => {}),
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBeNull();
  });
});
