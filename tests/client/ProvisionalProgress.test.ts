import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import type { PlayerStats } from "@openfront/engine-api/StatsSchemas";
import type {
  GameXpResponse,
  Progress,
  ProgressionConfig,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { XpRulesSchema } from "@openfront/shared/ApiSchemas";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { GameXpFetchResult } from "../../src/client/ProgressionApi";
import {
  applyGameXp,
  firstGameXp,
  MAX_PENDING_PER_ACCOUNT,
  noteFigure,
  PENDING_XP_CHECKED_KEY,
  PENDING_XP_KEY,
  PENDING_XP_TTL_MS,
  type PendingXp,
  pendingXpFor,
  projectPendingXp,
  PROVISIONAL_PROGRESS_CHANGED,
  type ProvisionalDeps,
  provisionalProgress,
  readPendingXp,
  recordPendingXp,
  runCheck,
  scoredGames,
  scoredUpTo,
  stackPendingXp,
  startProvisionalProgress,
  stopProvisionalProgress,
  withPendingXp,
} from "../../src/client/ProvisionalProgress";
import { computeXp } from "../../src/client/ProvisionalXp";

// Level 1 takes 100 XP, every later level 110: 250 XP from level 1 at 0 is
// level 3 with 40 of 110.
function config(over: Partial<ProgressionConfig> = {}): ProgressionConfig {
  return {
    version: 1,
    maxLevel: 100,
    maxPrestige: 10,
    levels: Array.from({ length: 100 }, (_, i) => ({
      level: i + 1,
      xpToNext: i + 1 >= 100 ? 0 : i === 0 ? 100 : 110,
      cumulativeXp: 0,
    })),
    flares: [],
    ...over,
  };
}

const LEVEL_1: Progress = {
  prestige: 0,
  level: 1,
  xpInLevel: 0,
  xpForNext: 100,
  lifetimeXp: 0,
  legend: false,
  canPrestige: false,
};

// Level 1 plus 250: level 3 with 40 of 110.
const AT_250: Progress = {
  ...LEVEL_1,
  level: 3,
  xpInLevel: 40,
  xpForNext: 110,
  lifetimeXp: 250,
};

const T0 = Date.UTC(2026, 9, 13, 12);
const TODAY = "2026-10-13";

// The API's answer for a game it scored: `xp`, taking the player's lifetime
// XP from `from` to `from + xp`.
function scored(gameId: string, xp: number, from = 0): GameXpResponse {
  return {
    gameId,
    eligible: true,
    breakdown: {
      leftEarly: false,
      played: xp,
      time: 0,
      placement: 0,
      win: 0,
      firstGame: 0,
      feats: 0,
      subtotal: xp,
      gamePermille: 1000,
      subscriberPermille: 1000,
      total: xp,
    },
    before: { prestige: 0, level: 1, xpInLevel: 0, xpForNext: 100 },
    after: { ...LEVEL_1, lifetimeXp: from + xp },
    levelsReached: [],
  };
}
const INELIGIBLE = (gameId: string): GameXpResponse => ({
  gameId,
  eligible: false,
  reason: "too_short",
});
const NOT_SCORED: GameXpFetchResult = { status: "pending", notFound: true };

const entry = (extra: Partial<PendingXp>): PendingXp => ({
  gameId: "gA",
  xp: 250,
  at: T0,
  notIn: 0,
  ...extra,
});

beforeEach(() => {
  stopProvisionalProgress();
  localStorage.clear();
});

describe("pending XP storage", () => {
  it("keeps a game's figure per account, a second one replacing the first", () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 }, T0);
    recordPendingXp("me", { gameId: "g1", xp: 300, notIn: 0 }, T0 + 1);
    expect(readPendingXp("me", T0)).toEqual([
      { gameId: "g1", xp: 300, at: T0 + 1, notIn: 0 },
    ]);
    // Another account on the same browser never sees it.
    expect(readPendingXp("someone-else", T0)).toEqual([]);
  });

  it("stores nothing for no XP", () => {
    recordPendingXp("me", { gameId: "g1", xp: 0 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: Number.NaN }, T0);
    expect(localStorage.getItem(PENDING_XP_KEY)).toBeNull();
  });

  it("expires an entry after 12 hours", () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    expect(readPendingXp("me", T0 + PENDING_XP_TTL_MS - 1)).toHaveLength(1);
    expect(readPendingXp("me", T0 + PENDING_XP_TTL_MS)).toEqual([]);
    expect(PENDING_XP_TTL_MS).toBe(12 * 60 * 60 * 1000);
    // Pruned, any account's, on the next write.
    recordPendingXp("other", { gameId: "g2", xp: 5 }, T0 + PENDING_XP_TTL_MS);
    expect(
      Object.keys(JSON.parse(localStorage.getItem(PENDING_XP_KEY)!)),
    ).toEqual(["other"]);
  });

  it("prunes scored games first, then the oldest, past the cap", () => {
    for (let i = 0; i < MAX_PENDING_PER_ACCOUNT; i++) {
      recordPendingXp("me", { gameId: `g${i}`, xp: 10 }, T0 + i);
    }
    applyGameXp("me", scored("g5", 10), {}, T0 + 50);
    recordPendingXp("me", { gameId: "new", xp: 10 }, T0 + 100);
    const kept = readPendingXp("me", T0 + 100).map((e) => e.gameId);
    expect(kept).toHaveLength(MAX_PENDING_PER_ACCOUNT);
    expect(kept).not.toContain("g5");
    recordPendingXp("me", { gameId: "newer", xp: 10 }, T0 + 101);
    expect(readPendingXp("me", T0 + 101).map((e) => e.gameId)).not.toContain(
      "g0",
    );
  });

  it("parses the store with one schema: anything off reads as empty", () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    for (const bad of [
      "{not json",
      JSON.stringify({ me: [{ gameId: "g1", xp: "lots", at: T0 }] }),
      JSON.stringify({ me: [{ gameId: "g1", xp: 1, at: T0, kind: "ranked" }] }),
      JSON.stringify([1, 2]),
    ]) {
      localStorage.setItem(PENDING_XP_KEY, bad);
      // A fresh read (as after a storage event).
      stopProvisionalProgress();
      expect(readPendingXp("me", T0)).toEqual([]);
    }
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(readPendingXp("me", T0)).toEqual([]);
      expect(() =>
        recordPendingXp("me", { gameId: "g1", xp: 250 }, T0),
      ).not.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("marks an eligible answer scored, keeping or adding the game, and drops an ineligible one", () => {
    // Recorded at death with a guessed first-game bonus the API didn't pay.
    recordPendingXp(
      "me",
      {
        gameId: "gA",
        xp: 250,
        day: TODAY,
        kind: "public",
        firstGame: 100,
        notIn: 0,
      },
      T0,
    );
    recordPendingXp("me", { gameId: "gB", xp: 50 }, T0);
    applyGameXp("me", scored("gA", 260), {}, T0 + 1);
    applyGameXp("me", INELIGIBLE("gB"), {}, T0 + 1);
    // A game played to the end: added, scored.
    applyGameXp(
      "me",
      scored("gC", 40, 260),
      { day: TODAY, kind: "private" },
      T0 + 2,
    );
    expect(readPendingXp("me", T0 + 2)).toEqual([
      // The kept day and kind stay; the server's XP and bonus win, and the
      // 12h runs from the score.
      expect.objectContaining({
        gameId: "gA",
        xp: 260,
        at: T0 + 1,
        day: TODAY,
        kind: "public",
        firstGame: 0,
        scored: { xp: 260, lifetimeAfter: 260 },
      }),
      expect.objectContaining({
        gameId: "gC",
        xp: 40,
        kind: "private",
        firstGame: 0,
        scored: { xp: 40, lifetimeAfter: 300 },
      }),
    ]);
  });
});

describe("projectPendingXp", () => {
  it("runs the XP through the level curve", () => {
    expect(projectPendingXp(LEVEL_1, 250, config())).toEqual(AT_250);
  });

  it("stops provisional XP at the last level: no Prestige, no Legend", () => {
    const near: Progress = {
      ...LEVEL_1,
      prestige: 10,
      level: 99,
      xpInLevel: 100,
      xpForNext: 110,
    };
    expect(projectPendingXp(near, 5_000, config())).toMatchObject({
      level: 100,
      xpInLevel: 0,
      legend: false,
      canPrestige: false,
    });
  });

  it("gives scored XP the API's own Prestige and Legend", () => {
    const near = { ...LEVEL_1, level: 99, xpInLevel: 100, xpForNext: 110 };
    expect(projectPendingXp(near, 500, config(), false)).toMatchObject({
      level: 100,
      canPrestige: true,
      legend: false,
    });
    expect(
      projectPendingXp({ ...near, prestige: 10 }, 500, config(), false),
    ).toMatchObject({ level: 100, canPrestige: false, legend: true });
  });

  it("projects nothing where the API stops accruing, or without the place in the level", () => {
    const atCap = { ...LEVEL_1, level: 100, canPrestige: true };
    expect(projectPendingXp(atCap, 500, config())).toBeNull();
    expect(projectPendingXp({ ...LEVEL_1, legend: true }, 5, config())).toBe(
      null,
    );
    expect(projectPendingXp(LEVEL_1, 0, config())).toBeNull();
    expect(
      projectPendingXp({ ...LEVEL_1, xpInLevel: undefined }, 250, config()),
    ).toBeNull();
    expect(projectPendingXp(LEVEL_1, 250, config({ levels: [] }))).toBeNull();
  });
});

describe("pendingXpFor", () => {
  const counted = (lifetimeXp: number, entries: PendingXp[]) =>
    pendingXpFor({ lifetimeXp }, entries).counted.map((e) => e.gameId);

  it("counts a scored game only onto a figure that doesn't include it", () => {
    const gA = entry({ scored: { xp: 260, lifetimeAfter: 260 } });
    expect(counted(0, [gA])).toEqual(["gA"]);
    expect(counted(259, [gA])).toEqual(["gA"]);
    expect(counted(260, [gA])).toEqual([]);
    expect(counted(400, [gA])).toEqual([]);
  });

  it("counts an unscored game up to its notIn, and past it only by known scored games", () => {
    const gA = entry({ gameId: "gA", notIn: 100 });
    expect(counted(100, [gA])).toEqual(["gA"]);
    // Game C, played to the end here, scored 40 since: explained.
    const gC = entry({
      gameId: "gC",
      xp: 40,
      scored: { xp: 40, lifetimeAfter: 140 },
    });
    expect(counted(140, [gA, gC])).toEqual(["gA"]);
    // A rise nothing here explains (another device, A itself): uncertain.
    const unexplained = pendingXpFor({ lifetimeXp: 150 }, [gA, gC]);
    expect(unexplained.counted.map((e) => e.gameId)).toEqual([]);
    expect(unexplained.uncertain).toBe(true);
    // Never asked about: uncertain.
    const neverAsked = { ...gA, notIn: undefined };
    expect(pendingXpFor({ lifetimeXp: 0 }, [neverAsked]).uncertain).toBe(true);
  });
});

describe("firstGameXp", () => {
  it("is exactly what the bonus added, rounded as the API rounds the total", () => {
    expect(
      firstGameXp({
        firstGame: 50,
        subtotal: 101,
        gamePermille: 1250,
        subscriberPermille: 1000,
      }),
    ).toBe(62);
    expect(
      firstGameXp({
        firstGame: 0,
        subtotal: 101,
        gamePermille: 1250,
        subscriberPermille: 1000,
      }),
    ).toBe(0);
  });
});

describe("the first-game bonus, scored out of order", () => {
  it("isn't counted again for a pending game once a scored game that day has it", () => {
    // A died with the day's bonus (100 of its 250); B ended first and the API
    // gave B the bonus.
    const gA = entry({ gameId: "gA", day: TODAY, firstGame: 100 });
    const gB = entry({
      gameId: "gB",
      xp: 200,
      day: TODAY,
      firstGame: 100,
      scored: { xp: 200, lifetimeAfter: 200 },
    });
    // On a figure with B: A counts without its bonus.
    const onB = pendingXpFor({ lifetimeXp: 200 }, [gA, gB]).counted;
    expect(onB.map((e) => [e.gameId, e.xp])).toEqual([["gA", 150]]);
    // B scored without the bonus, or on another day: A keeps it.
    for (const other of [
      { ...gB, firstGame: 0 },
      { ...gB, day: "2026-10-12" },
    ]) {
      expect(pendingXpFor({ lifetimeXp: 200 }, [gA, other]).counted[0].xp).toBe(
        250,
      );
    }
  });
});

describe("stacking pending games at death", () => {
  const withDaily = (
    daily: Partial<NonNullable<Progress["daily"]>> = {},
  ): Progress => ({
    ...LEVEL_1,
    daily: {
      day: TODAY,
      privateGames: 0,
      singleplayerGames: 0,
      firstGameClaimed: false,
      ...daily,
    },
    subscriberPermille: 1000,
  });

  it("starts from where the pending games' XP takes the player, never past the last level", () => {
    expect(stackPendingXp(withDaily(), [entry({})], config())).toMatchObject({
      level: 3,
      xpInLevel: 40,
    });
    const near = { ...withDaily(), prestige: 10, level: 98, xpForNext: 110 };
    expect(
      stackPendingXp(
        near,
        [entry({ xp: 150 }), entry({ gameId: "gB", xp: 400 })],
        config(),
      ),
    ).toMatchObject({ level: 100, legend: false, canPrestige: false });
  });

  it("counts the day's allowances of same-day games only", () => {
    const stacked = stackPendingXp(
      withDaily({ privateGames: 2, singleplayerGames: 1 }),
      [
        entry({ gameId: "p1", day: TODAY, kind: "private" }),
        entry({ gameId: "s1", day: TODAY, kind: "singleplayer" }),
        entry({ gameId: "a", day: TODAY, kind: "public", firstGame: 100 }),
        // Another UTC day, or no day: the allowances are left alone.
        entry({ gameId: "p2", day: "2026-10-12", kind: "private" }),
        entry({ gameId: "p3", kind: "private", firstGame: 100 }),
      ],
      config(),
    );
    expect(stacked.daily).toMatchObject({
      privateGames: 3,
      singleplayerGames: 2,
      firstGameClaimed: true,
    });
  });

  it("applies the day's caps to the next game's figure", () => {
    const rules = XpRulesSchema.parse({
      minAliveTicks: 0,
      gameXp: 50,
      xpPerMinute: 10,
      timeCapMinutes: 30,
      ffaPlacementMax: 0,
      ffaWin: 0,
      fullLobbyHumans: 20,
      teamWin: 0,
      teamWinMinAlivePermille: 500,
      hvnWin: 0,
      firstGameOfDay: 100,
      featXp: 0,
      maxFeatsPerGame: 0,
      publicPermille: 1000,
      rankedPermille: 1000,
      privatePermille: 500,
      singleplayerPermille: 250,
      privateMinHumans: 1,
      privateGamesPerDay: 2,
      singleplayerGamesPerDay: 2,
    });
    const scorePrivate = (daily: NonNullable<Progress["daily"]>) =>
      computeXp(
        {
          config: {
            gameType: GameType.Private,
            gameMode: GameMode.FFA,
            infiniteGold: false,
            infiniteTroops: false,
            instantBuild: false,
          },
          stats: { attacks: [1n], killedAt: 6000n } as PlayerStats,
          leftAtTick: null,
          isWinner: false,
          ticks: 6000,
          spawnedHumans: 2,
          opponentsOutlasted: 0,
          featCount: 0,
          daily,
          subscriberPermille: 1000,
        },
        rules,
      );
    const progress = withDaily({ privateGames: 1 });
    expect(scorePrivate(progress.daily!).eligible).toBe(true);
    const stacked = stackPendingXp(
      progress,
      [entry({ day: TODAY, kind: "private" })],
      config(),
    );
    expect(scorePrivate(stacked.daily!)).toEqual({
      eligible: false,
      reason: "daily_cap",
    });
  });

  it("decides from the stored answers, asking nothing, the game itself left out", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    recordPendingXp("me", {
      gameId: "gA",
      xp: 250,
      day: TODAY,
      firstGame: 100,
      notIn: 0,
    });
    recordPendingXp("me", { gameId: "gB", xp: 999, notIn: 0 });
    // Never asked about: left out.
    recordPendingXp("me", { gameId: "gX", xp: 999 });
    const start = withPendingXp("me", withDaily(), config(), "gB");
    expect(start).toMatchObject({ level: 3, xpInLevel: 40 });
    expect(start.daily?.firstGameClaimed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("counts a scored game on a stale figure, and not on one that includes it", () => {
    applyGameXp("me", scored("gA", 250), { day: TODAY }, Date.now());
    expect(withPendingXp("me", withDaily(), config(), "gB").level).toBe(3);
    expect(
      withPendingXp("me", { ...withDaily(), ...AT_250 }, config(), "gB"),
    ).toMatchObject({ level: 3, xpInLevel: 40 });
  });
});

describe("the store", () => {
  let answers: Map<string, GameXpFetchResult | (() => GameXpFetchResult)>;
  let fetchXp: Mock<ProvisionalDeps["fetchXp"]>;
  let refreshUserMe: Mock<ProvisionalDeps["refreshUserMe"]>;
  let loadConfig: Mock<ProvisionalDeps["loadConfig"]>;

  const me = (progress: Progress = LEVEL_1): UserMeResponse =>
    ({
      user: { email: "wonder@example.com" },
      player: { publicId: "me", progress },
    }) as unknown as UserMeResponse;
  const broadcast = (progress: Progress) =>
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: me(progress) }),
    );
  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const check = async () => {
    await runCheck();
    await settle();
  };
  const view = (progress: Progress) => provisionalProgress("me", progress);
  const asked = () => fetchXp.mock.calls.map((c) => c[0]);

  function start(over: Partial<ProvisionalDeps> = {}) {
    startProvisionalProgress({ fetchXp, loadConfig, refreshUserMe, ...over });
  }

  beforeEach(() => {
    answers = new Map();
    fetchXp = vi.fn(async (gameId: string) => {
      const answer = answers.get(gameId) ?? NOT_SCORED;
      return typeof answer === "function" ? answer() : answer;
    });
    refreshUserMe = vi.fn(async () => false as const);
    loadConfig = vi.fn(async () => config());
    start();
  });

  afterEach(() => {
    stopProvisionalProgress();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("counts a game stored at death at once, asking nothing", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    const shown = view(LEVEL_1);
    expect(shown.provisional).toBe(true);
    expect(shown.confirmedLevel).toBe(1);
    expect(shown.progress).toMatchObject({ level: 3, xpInLevel: 40 });
    // The same object while nothing changes.
    expect(view(LEVEL_1)).toBe(shown);
    expect(fetchXp).not.toHaveBeenCalled();
  });

  it("never projects onto another player's progress", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    expect(provisionalProgress("someone", LEVEL_1).provisional).toBe(false);
  });

  it("starts nothing from render", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    // A figure the stored answers can't settle, read by a view.
    const fresher = { ...LEVEL_1, lifetimeXp: 10, xpInLevel: 10 };
    for (let i = 0; i < 5; i++) expect(view(fresher).progress).toBe(fresher);
    await settle();
    expect(fetchXp).not.toHaveBeenCalled();
    // Config isn't loaded from render either: only from the broadcast.
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it("asks about the games a broadcast figure leaves uncertain, and only those", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    recordPendingXp("me", { gameId: "g2", xp: 30, notIn: 50 });
    // A rise of 20 nothing here explains: g1 is uncertain, g2 isn't.
    const figure = { ...LEVEL_1, lifetimeXp: 20, xpInLevel: 20 };
    broadcast(figure);
    await settle();
    expect(asked()).toEqual(["g1"]);
    // The 404 vouches for g1 on this figure now.
    expect(view(figure).progress).toMatchObject({ level: 3, xpInLevel: 90 });
  });

  it("keeps game A counted when game C, played to the end here, is scored: no drop, no replay", async () => {
    recordPendingXp("me", { gameId: "gA", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    const before = view(LEVEL_1).progress;
    expect(before).toMatchObject({ level: 3, xpInLevel: 40 });

    // C ends in the win modal, scored at 110.
    applyGameXp("me", scored("gC", 110));
    // The fresh account includes C: lifetime 110, level 2 at 10.
    const withC = {
      ...LEVEL_1,
      level: 2,
      xpInLevel: 10,
      xpForNext: 110,
      lifetimeXp: 110,
    };
    const levels: number[] = [];
    document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, () =>
      levels.push(view(withC).progress.level),
    );
    broadcast(withC);
    await settle();
    // A still counts on top of C: 110 + 250 = 360, level 4 at 40, from the
    // first frame on.
    expect(view(withC).progress).toMatchObject({ level: 4, xpInLevel: 40 });
    expect(view(withC).provisional).toBe(true);
    expect(levels.every((l) => l === 4)).toBe(true);
    // Nothing had to be asked.
    expect(fetchXp).not.toHaveBeenCalled();
  });

  describe("a scored game", () => {
    beforeEach(async () => {
      recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
      broadcast(LEVEL_1);
      await settle();
      answers.set("g1", { status: "ok", data: scored("g1", 260) });
    });

    it("counts onto a stale figure as confirmed XP, not provisional", async () => {
      await check();
      const shown = view({ ...LEVEL_1 });
      expect(shown.provisional).toBe(false);
      expect(shown.progress).toMatchObject({ level: 3, xpInLevel: 50 });
      // Confirmed: nothing past the level the scored XP reached is pending.
      expect(shown.confirmedLevel).toBe(3);
    });

    it("isn't counted onto a figure that includes it", async () => {
      await check();
      const fresh = { ...AT_250, xpInLevel: 50, lifetimeXp: 260 };
      expect(view(fresh).progress).toBe(fresh);
    });

    it("isn't counted twice when the account can't be re-read after it", async () => {
      // A figure read after the API scored it shows before the check knows:
      // its rise is unexplained, so the unscored entry isn't counted on it.
      const readAfter = { ...AT_250, xpInLevel: 50, lifetimeXp: 260 };
      expect(view(readAfter).progress).toBe(readAfter);
      refreshUserMe.mockRejectedValueOnce(new Error("offline"));
      await check();
      expect(view(readAfter).progress).toBe(readAfter);
      expect(view({ ...LEVEL_1 }).progress.level).toBe(3);
    });

    it("reads the account afresh once; its broadcast, explained by the game, asks nothing more", async () => {
      recordPendingXp("me", { gameId: "g2", xp: 30, notIn: 0 });
      // broadcastFreshUserMe: the account with g1's 260.
      refreshUserMe.mockImplementation(async () =>
        document.dispatchEvent(
          new CustomEvent("userMeResponse", {
            detail: me({ ...AT_250, lifetimeXp: 260 }),
          }),
        ),
      );
      const changed = vi.fn();
      document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
      await check();
      await settle();
      expect(refreshUserMe).toHaveBeenCalledTimes(1);
      expect(asked()).toEqual(["g1", "g2"]);
      const events = changed.mock.calls.map(([e]) => e as Event);
      expect(events.map(scoredGames)).toContainEqual(["g1"]);
      expect(events.map(scoredUpTo)).toContain(260);
      document.removeEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
    });

    it("still checks any other broadcast that arrives during its read", async () => {
      recordPendingXp("me", { gameId: "g2", xp: 30, notIn: 0 });
      let finish!: () => void;
      refreshUserMe.mockImplementation(
        () => new Promise<void>((r) => (finish = r)),
      );
      const done = runCheck();
      await settle();
      expect(asked()).toEqual(["g1", "g2"]);
      // A purchase broadcasts the account meanwhile, with a rise nothing here
      // explains: it's queued and asked about once the read is done.
      broadcast({ ...AT_250, lifetimeXp: 400 });
      finish();
      await done;
      await settle();
      expect(asked()).toEqual(["g1", "g2", "g2"]);
    });

    it("lets a figure at the last level Prestige", async () => {
      await check();
      const near = {
        ...LEVEL_1,
        level: 99,
        xpInLevel: 100,
        xpForNext: 110,
      };
      const shown = view(near);
      expect(shown.provisional).toBe(false);
      expect(shown.progress).toMatchObject({ level: 100, canPrestige: true });
    });
  });

  it("drops a game the API ruled ineligible, and counts nothing for it", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    answers.set("g1", { status: "ok", data: INELIGIBLE("g1") });
    await check();
    expect(readPendingXp("me")).toEqual([]);
    expect(view({ ...LEVEL_1 }).progress.level).toBe(1);
    expect(refreshUserMe).not.toHaveBeenCalled();
  });

  it("asks one game at a time", async () => {
    let inFlight = 0;
    let most = 0;
    fetchXp.mockImplementation(async () => {
      most = Math.max(most, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return NOT_SCORED;
    });
    for (let i = 0; i < 5; i++) {
      recordPendingXp("me", { gameId: `g${i}`, xp: 10, notIn: 0 });
    }
    broadcast(LEVEL_1);
    await check();
    expect(fetchXp).toHaveBeenCalledTimes(5);
    expect(most).toBe(1);
  });

  it("stops at a 429, keeps the level, and doesn't ask again until a poll interval later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    for (const id of ["g1", "g2", "g3"]) {
      recordPendingXp("me", { gameId: id, xp: 100, notIn: 0 });
    }
    broadcast(LEVEL_1);
    await vi.advanceTimersByTimeAsync(0);
    answers.set("g1", { status: "pending", rateLimited: true });
    await runCheck();
    expect(asked()).toEqual(["g1"]);
    // 300 XP: level 3 at 90, as before.
    expect(view(LEVEL_1).progress).toMatchObject({ level: 3, xpInLevel: 90 });
    // A broadcast or a call straight after asks nothing.
    broadcast({ ...LEVEL_1, lifetimeXp: 5 });
    await runCheck();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(asked()).toEqual(["g1"]);
    // A poll interval later it asks again.
    answers.delete("g1");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(asked().length).toBeGreaterThan(1);
  });

  it("keeps a game's last verdict through a failure", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    answers.set("g1", () => {
      throw new Error("network down");
    });
    await check();
    answers.set("g1", { status: "unavailable" });
    await check();
    expect(view(LEVEL_1).progress.level).toBe(3);
  });

  it("follows another tab through storage, asking nothing", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    // The other tab: g1 scored at 250, written to storage.
    const raw = JSON.parse(localStorage.getItem(PENDING_XP_KEY)!);
    raw.me[0].scored = { xp: 250, lifetimeAfter: 250 };
    localStorage.setItem(PENDING_XP_KEY, JSON.stringify(raw));
    const changed = vi.fn();
    document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
    window.dispatchEvent(new StorageEvent("storage", { key: PENDING_XP_KEY }));
    await settle();
    expect(changed).toHaveBeenCalled();
    // This tab's figure from before holds its level, now confirmed.
    expect(view(LEVEL_1)).toMatchObject({
      provisional: false,
      progress: { level: 3, xpInLevel: 40 },
    });
    expect(fetchXp).not.toHaveBeenCalled();
    expect(refreshUserMe).not.toHaveBeenCalled();
    document.removeEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
  });

  it("forgets the account when the session goes", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    document.dispatchEvent(new CustomEvent("session-cleared"));
    expect(view(LEVEL_1).provisional).toBe(false);
  });

  it("shows the confirmed figures without a config", async () => {
    loadConfig.mockResolvedValue(false);
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    expect(view(LEVEL_1).provisional).toBe(false);
  });

  describe("the level the rewards list can judge (confirmedLevel)", () => {
    it("is null when nothing is added", async () => {
      broadcast(LEVEL_1);
      await settle();
      expect(view(LEVEL_1).confirmedLevel).toBeNull();
    });

    it("is the figure's level under unscored XP: those levels are pending", async () => {
      recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
      broadcast(LEVEL_1);
      await settle();
      expect(view(LEVEL_1)).toMatchObject({
        provisional: true,
        confirmedLevel: 1,
        progress: { level: 3 },
      });
    });

    it("is the level after scored XP when only scored XP is added", async () => {
      applyGameXp("me", scored("g1", 250));
      broadcast(LEVEL_1);
      await settle();
      expect(view({ ...LEVEL_1 })).toMatchObject({
        provisional: false,
        confirmedLevel: 3,
        progress: { level: 3 },
      });
    });

    it("keys its memo on what decides it", async () => {
      recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
      broadcast(LEVEL_1);
      await settle();
      const figure = { ...LEVEL_1 };
      const first = view(figure);
      expect(view(figure)).toBe(first);
      // The same XP, now scored: confirmed, a new view.
      applyGameXp("me", scored("g1", 250));
      const second = view(figure);
      expect(second).not.toBe(first);
      expect(second).toMatchObject({ provisional: false, confirmedLevel: 3 });
    });
  });

  it("converges a public figure ahead of /users/@me after one check", async () => {
    const userMe = { ...LEVEL_1, lifetimeXp: 1000 };
    // A game on another device: the public figure has 150 /users/@me lacks.
    const publicFigure = { ...LEVEL_1, lifetimeXp: 1150, xpInLevel: 50 };
    recordPendingXp("me", { gameId: "gA", xp: 250, notIn: 1000 });
    broadcast(userMe);
    await settle();
    expect(view(userMe).provisional).toBe(true);
    expect(view(publicFigure).provisional).toBe(false);
    // The Progression tab hands its figure in: one check, and both count A.
    noteFigure("me", publicFigure);
    await settle();
    expect(asked()).toEqual(["gA"]);
    expect(view(publicFigure)).toMatchObject({
      provisional: true,
      progress: { level: 3, xpInLevel: 90 },
    });
    expect(view(userMe).provisional).toBe(true);
    // Someone else's figure starts nothing.
    noteFigure("someone", { lifetimeXp: 99_999 });
    await settle();
    expect(asked()).toEqual(["gA"]);
  });

  it("re-runs a check asked for mid-check with its figure, asking only what it leaves uncertain", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 10, notIn: 0 });
    recordPendingXp("me", { gameId: "g2", xp: 10, notIn: 500 });
    broadcast(LEVEL_1);
    await settle();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchXp.mockImplementationOnce(async () => {
      await gate;
      return NOT_SCORED;
    });
    const first = runCheck();
    // Two figures arrive while it runs: the re-run keeps the newest.
    void runCheck({ lifetimeXp: 100 });
    void runCheck({ lifetimeXp: 300 });
    release();
    await first;
    await settle();
    // First round: both. Re-run on lifetime 300: g2 (notIn 500) is settled.
    expect(asked()).toEqual(["g1", "g2", "g1"]);
  });

  describe("polling", () => {
    let visible: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stopProvisionalProgress();
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      visible = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("visible");
      recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 });
    });

    it("asks every minute while the page shows, up to a cap", async () => {
      start({ pollMs: 60_000, maxPolls: 2 });
      broadcast(LEVEL_1);
      visible.mockReturnValue("hidden");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchXp).not.toHaveBeenCalled();
      visible.mockReturnValue("visible");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchXp).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchXp).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(fetchXp).toHaveBeenCalledTimes(2);
    });

    it("skips a tick within the interval after any check, without using a poll", async () => {
      start({ pollMs: 60_000, maxPolls: 1 });
      broadcast(LEVEL_1);
      // Its own check half way through the interval: the tick is skipped,
      // and doesn't count against the cap.
      await vi.advanceTimersByTimeAsync(30_000);
      await runCheck();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchXp).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchXp).toHaveBeenCalledTimes(2);
      // Another tab's check: the next poll is skipped.
      await vi.advanceTimersByTimeAsync(30_000);
      localStorage.setItem(
        PENDING_XP_CHECKED_KEY,
        JSON.stringify({ me: { at: Date.now(), tab: "other-tab" } }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchXp).toHaveBeenCalledTimes(2);
    });

    it("throttles a figure's check like a poll", async () => {
      const userMe = { ...LEVEL_1, lifetimeXp: 1000 };
      localStorage.clear();
      start({ pollMs: 60_000 });
      recordPendingXp("me", { gameId: "gA", xp: 250, notIn: 1000 });
      broadcast(userMe);
      // The answers keep failing: notIn never rises.
      answers.set("gA", { status: "pending" });
      noteFigure("me", { lifetimeXp: 1150 });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchXp).toHaveBeenCalledTimes(1);
      // Reopening the tab soon after sends nothing more...
      noteFigure("me", { lifetimeXp: 1150 });
      await vi.advanceTimersByTimeAsync(10_000);
      noteFigure("me", { lifetimeXp: 1150 });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchXp).toHaveBeenCalledTimes(1);
      // ...nor after another tab asked.
      await vi.advanceTimersByTimeAsync(45_000);
      localStorage.setItem(
        PENDING_XP_CHECKED_KEY,
        JSON.stringify({ me: { at: Date.now(), tab: "other-tab" } }),
      );
      noteFigure("me", { lifetimeXp: 1150 });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchXp).toHaveBeenCalledTimes(1);
    });

    it("checks on a return to the page only a poll interval after its own last check, outside the cap", async () => {
      start({ pollMs: 60_000, maxPolls: 2 });
      broadcast(LEVEL_1);
      const back = () => document.dispatchEvent(new Event("visibilitychange"));
      // The first return checks; the next ones, within the interval, don't.
      back();
      await vi.advanceTimersByTimeAsync(1_000);
      for (let i = 0; i < 5; i++) {
        back();
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(fetchXp).toHaveBeenCalledTimes(1);
      // The timer's two polls still run: the returns didn't use them up.
      await vi.advanceTimersByTimeAsync(55_000);
      expect(fetchXp).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchXp).toHaveBeenCalledTimes(3);
      // Capped: the timer stops...
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(fetchXp).toHaveBeenCalledTimes(3);
      // ...but a return to the page after the interval still checks.
      back();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchXp).toHaveBeenCalledTimes(4);
    });

    it("stops once nothing is unscored", async () => {
      answers.set("g1", { status: "ok", data: scored("g1", 250) });
      start({ pollMs: 60_000 });
      broadcast(LEVEL_1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchXp).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetchXp).toHaveBeenCalledTimes(1);
    });
  });
});

describe("back-to-back games", () => {
  let answers: Map<string, GameXpFetchResult>;

  beforeEach(() => {
    answers = new Map();
    startProvisionalProgress({
      fetchXp: async (gameId) => answers.get(gameId) ?? NOT_SCORED,
      loadConfig: async () => config(),
      refreshUserMe: async () => undefined,
    });
  });

  afterEach(() => stopProvisionalProgress());

  const broadcast = (progress: Progress) =>
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: { user: {}, player: { publicId: "me", progress } },
      }),
    );
  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it("stacks two pending games", async () => {
    recordPendingXp("me", { gameId: "gA", xp: 250, notIn: 0 });
    recordPendingXp("me", { gameId: "gB", xp: 150, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    // 400 XP from level 1: 100 + 110 + 110, then 80 into level 4.
    expect(provisionalProgress("me", LEVEL_1).progress).toMatchObject({
      level: 4,
      xpInLevel: 80,
      lifetimeXp: 400,
    });
  });

  it("keeps B on top once A is scored, without counting A twice", async () => {
    recordPendingXp("me", { gameId: "gA", xp: 250, notIn: 0 });
    recordPendingXp("me", { gameId: "gB", xp: 150, notIn: 0 });
    broadcast(LEVEL_1);
    await settle();
    answers.set("gA", { status: "ok", data: scored("gA", 250) });
    await runCheck();
    await settle();
    // On the account with A (a rise A explains) and on the one before it.
    for (const figure of [AT_250, LEVEL_1]) {
      expect(provisionalProgress("me", figure).progress).toMatchObject({
        level: 4,
        xpInLevel: 80,
      });
    }
    expect(provisionalProgress("me", AT_250).confirmedLevel).toBe(3);
  });
});
