import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import type { PlayerStats } from "@openfront/engine-api/StatsSchemas";
import type {
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
  clearPendingXp,
  MAX_PENDING_PER_ACCOUNT,
  PENDING_XP_KEY,
  PENDING_XP_TTL_MS,
  type PendingXp,
  progressWithPendingXp,
  projectPendingXp,
  PROVISIONAL_PROGRESS_CHANGED,
  type ProvisionalDeps,
  provisionalProgress,
  readPendingXp,
  recordPendingXp,
  runCheck,
  stackPendingXp,
  startProvisionalProgress,
  stopProvisionalProgress,
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
      cumulativeXp: i === 0 ? 0 : 100 + (i - 1) * 110,
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

const T0 = Date.UTC(2026, 9, 13, 12);

beforeEach(() => {
  localStorage.clear();
});

describe("pending XP storage", () => {
  it("keeps a game's figure per account", () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    expect(readPendingXp("me", T0)).toEqual([
      { gameId: "g1", xp: 250, at: T0 },
    ]);
    // Another account on the same browser never sees it.
    expect(readPendingXp("someone-else", T0)).toEqual([]);
  });

  it("replaces a second figure for the same game", () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    recordPendingXp("me", { gameId: "g1", xp: 300 }, T0 + 1000);
    recordPendingXp("me", { gameId: "g2", xp: 40 }, T0 + 2000);
    expect(readPendingXp("me", T0 + 2000).map((e) => [e.gameId, e.xp])).toEqual(
      [
        ["g1", 300],
        ["g2", 40],
      ],
    );
  });

  it("stores nothing for no XP, a bad figure or no account", () => {
    recordPendingXp("me", { gameId: "g1", xp: 0 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: Number.NaN }, T0);
    recordPendingXp("me", { gameId: "", xp: 10 }, T0);
    recordPendingXp("", { gameId: "g3", xp: 10 }, T0);
    expect(localStorage.getItem(PENDING_XP_KEY)).toBeNull();
  });

  it("expires an entry after 24 hours", () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    expect(readPendingXp("me", T0 + PENDING_XP_TTL_MS - 1)).toHaveLength(1);
    expect(readPendingXp("me", T0 + PENDING_XP_TTL_MS)).toEqual([]);
    // A clock set back a day doesn't keep it forever either.
    expect(readPendingXp("me", T0 - PENDING_XP_TTL_MS)).toEqual([]);
  });

  it("prunes expired entries, any account's, on a write", () => {
    recordPendingXp("other", { gameId: "old", xp: 10 }, T0);
    recordPendingXp(
      "me",
      { gameId: "new", xp: 20 },
      T0 + PENDING_XP_TTL_MS + 1,
    );
    const raw = JSON.parse(localStorage.getItem(PENDING_XP_KEY)!);
    expect(Object.keys(raw)).toEqual(["me"]);
  });

  it("keeps at most the newest entries per account", () => {
    for (let i = 0; i < MAX_PENDING_PER_ACCOUNT + 3; i++) {
      recordPendingXp("me", { gameId: `g${i}`, xp: 10 }, T0 + i);
    }
    const kept = readPendingXp("me", T0 + 100);
    expect(kept).toHaveLength(MAX_PENDING_PER_ACCOUNT);
    expect(kept[0].gameId).toBe("g3");
  });

  it("clears entries, and the key once nothing is left", () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: 50 }, T0);
    clearPendingXp("me", ["g1"], T0);
    expect(readPendingXp("me", T0).map((e) => e.gameId)).toEqual(["g2"]);
    clearPendingXp("me", ["g2"], T0);
    expect(localStorage.getItem(PENDING_XP_KEY)).toBeNull();
  });

  it("reads unreadable storage as nothing pending", () => {
    localStorage.setItem(PENDING_XP_KEY, "{not json");
    expect(readPendingXp("me", T0)).toEqual([]);
    localStorage.setItem(
      PENDING_XP_KEY,
      JSON.stringify({ me: [{ gameId: "g1", xp: "lots", at: T0 }, null] }),
    );
    expect(readPendingXp("me", T0)).toEqual([]);
  });

  it("survives storage that throws", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      expect(() =>
        recordPendingXp("me", { gameId: "g1", xp: 250 }, T0),
      ).not.toThrow();
      expect(readPendingXp("me", T0)).toEqual([]);
      expect(() => clearPendingXp("me", ["g1"], T0)).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("projectPendingXp", () => {
  it("runs the XP through the level curve", () => {
    expect(projectPendingXp(LEVEL_1, 250, config())).toEqual({
      prestige: 0,
      level: 3,
      xpInLevel: 40,
      xpForNext: 110,
      lifetimeXp: 250,
      legend: false,
      canPrestige: false,
    });
  });

  it("stays within the level when it doesn't fill it", () => {
    const projected = projectPendingXp(
      { ...LEVEL_1, xpInLevel: 30, lifetimeXp: 30 },
      50,
      config(),
    );
    expect(projected).toMatchObject({ level: 1, xpInLevel: 80 });
  });

  it("stops at the last level, without offering Prestige", () => {
    const near: Progress = {
      ...LEVEL_1,
      prestige: 3,
      level: 99,
      xpInLevel: 100,
      xpForNext: 110,
      lifetimeXp: 50_000,
    };
    expect(projectPendingXp(near, 5_000, config())).toEqual({
      prestige: 3,
      level: 100,
      xpInLevel: 0,
      xpForNext: 0,
      lifetimeXp: 55_000,
      legend: false,
      canPrestige: false,
    });
  });

  it("never makes a Legend, even on the last prestige", () => {
    const lastRun: Progress = {
      ...LEVEL_1,
      prestige: 10,
      level: 99,
      xpInLevel: 0,
      xpForNext: 110,
      lifetimeXp: 900_000,
    };
    expect(projectPendingXp(lastRun, 500, config())).toMatchObject({
      prestige: 10,
      level: 100,
      legend: false,
      canPrestige: false,
    });
  });

  it("projects nothing where the API stops accruing", () => {
    const atCap: Progress = {
      ...LEVEL_1,
      level: 100,
      xpInLevel: 0,
      xpForNext: 0,
      canPrestige: true,
    };
    expect(projectPendingXp(atCap, 500, config())).toBeNull();
    expect(
      projectPendingXp(
        { ...atCap, prestige: 10, legend: true, canPrestige: false },
        500,
        config(),
      ),
    ).toBeNull();
  });

  it("projects nothing without XP, a place in the level, or the curve", () => {
    expect(projectPendingXp(LEVEL_1, 0, config())).toBeNull();
    expect(
      projectPendingXp(
        { prestige: 0, level: 1, lifetimeXp: 0, legend: false },
        250,
        config(),
      ),
    ).toBeNull();
    expect(projectPendingXp(LEVEL_1, 250, config({ levels: [] }))).toBeNull();
  });
});

describe("provisionalProgress", () => {
  let answers: Map<string, GameXpFetchResult>;
  let fetchXp: Mock<ProvisionalDeps["fetchXp"]>;
  let loadConfig: Mock<ProvisionalDeps["loadConfig"]>;
  let refreshUserMe: Mock<ProvisionalDeps["refreshUserMe"]>;
  let clock: number;

  const NOT_SCORED: GameXpFetchResult = { status: "pending", notFound: true };
  const SCORED = (gameId: string): GameXpFetchResult => ({
    status: "ok",
    data: { gameId, eligible: false, reason: "too_short" },
  });

  function me(progress: Progress = LEVEL_1, publicId = "me"): UserMeResponse {
    return {
      user: { email: "wonder@example.com" },
      player: { publicId, progress },
    } as unknown as UserMeResponse;
  }

  function broadcast(response: UserMeResponse | false): void {
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: response }),
    );
  }

  // Lets the check the broadcast started finish.
  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await runCheck();
  }

  beforeEach(() => {
    clock = T0;
    answers = new Map();
    fetchXp = vi.fn(
      async (gameId: string) => answers.get(gameId) ?? NOT_SCORED,
    );
    loadConfig = vi.fn(async () => config());
    refreshUserMe = vi.fn(async () => undefined);
    startProvisionalProgress({
      fetchXp,
      loadConfig,
      refreshUserMe,
      now: () => clock,
    });
  });

  afterEach(() => {
    stopProvisionalProgress();
    vi.useRealTimers();
  });

  it("projects the pending XP once the API says the game isn't scored", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    const response = me();
    broadcast(response);
    // Not before the check has answered.
    expect(provisionalProgress("me", LEVEL_1).provisional).toBe(false);
    await settle();
    expect(fetchXp).toHaveBeenCalledWith("g1");
    const view = provisionalProgress("me", response.player.progress!);
    expect(view.provisional).toBe(true);
    expect(view.confirmedLevel).toBe(1);
    expect(view.progress).toMatchObject({
      level: 3,
      xpInLevel: 40,
      xpForNext: 110,
    });
    // The same object while nothing changes.
    expect(provisionalProgress("me", response.player.progress!)).toBe(view);
  });

  it("adds every pending game", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 100 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: 150 }, T0);
    const response = me();
    broadcast(response);
    await settle();
    expect(
      provisionalProgress("me", response.player.progress!).progress,
    ).toMatchObject({ level: 3, xpInLevel: 40 });
  });

  it("never projects onto another player's progress", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    const response = me();
    broadcast(response);
    await settle();
    expect(
      provisionalProgress("someone-else", response.player.progress!)
        .provisional,
    ).toBe(false);
  });

  it("doesn't count a game onto a figure read after the last check", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    broadcast(me());
    await settle();
    // A figure read since may already include the game: it shows as it is.
    const fresher: Progress = { ...LEVEL_1, lifetimeXp: 10, xpInLevel: 10 };
    expect(provisionalProgress("me", fresher)).toEqual({
      progress: fresher,
      provisional: false,
      confirmedLevel: 1,
    });
    // Until a check after it says the game still isn't scored.
    await settle();
    expect(provisionalProgress("me", fresher).progress).toMatchObject({
      level: 3,
      xpInLevel: 50,
    });
  });

  it("clears a scored game, re-reads the account first, and says so", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: 30 }, T0);
    answers.set("g1", SCORED("g1"));
    const changed = vi.fn();
    document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
    let pendingWhenRefreshed: string[] = [];
    refreshUserMe.mockImplementation(async () => {
      pendingWhenRefreshed = readPendingXp("me", clock).map((e) => e.gameId);
    });
    try {
      const response = me();
      broadcast(response);
      await settle();
      expect(refreshUserMe).toHaveBeenCalledTimes(1);
      // Still there while the new figure is read, so the level never dips.
      expect(pendingWhenRefreshed).toEqual(["g1", "g2"]);
      expect(readPendingXp("me", clock).map((e) => e.gameId)).toEqual(["g2"]);
      expect(changed).toHaveBeenCalled();
      expect(
        provisionalProgress("me", response.player.progress!).progress,
      ).toMatchObject({ level: 1, xpInLevel: 30 });
    } finally {
      document.removeEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
    }
  });

  it("keeps but doesn't count a game it couldn't ask about", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    answers.set("g1", { status: "pending" });
    const response = me();
    broadcast(response);
    await settle();
    expect(
      provisionalProgress("me", response.player.progress!).provisional,
    ).toBe(false);
    expect(readPendingXp("me", clock)).toHaveLength(1);
    answers.set("g1", { status: "unavailable" });
    await settle();
    expect(
      provisionalProgress("me", response.player.progress!).provisional,
    ).toBe(false);
    expect(readPendingXp("me", clock)).toHaveLength(1);
    expect(refreshUserMe).not.toHaveBeenCalled();
  });

  it("shows the confirmed figures without a config", async () => {
    loadConfig.mockResolvedValue(false);
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    const response = me();
    broadcast(response);
    await settle();
    expect(
      provisionalProgress("me", response.player.progress!).provisional,
    ).toBe(false);
  });

  it("drops an expired entry without asking about it", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    clock = T0 + PENDING_XP_TTL_MS;
    const response = me();
    broadcast(response);
    await settle();
    expect(fetchXp).not.toHaveBeenCalled();
    expect(
      provisionalProgress("me", response.player.progress!).provisional,
    ).toBe(false);
  });

  it("forgets the account when the session goes", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    const response = me();
    broadcast(response);
    await settle();
    document.dispatchEvent(new CustomEvent("session-cleared"));
    expect(
      provisionalProgress("me", response.player.progress!).provisional,
    ).toBe(false);
    broadcast(false);
    expect(
      provisionalProgress("me", response.player.progress!).provisional,
    ).toBe(false);
  });

  it("asks again every minute while the page shows, up to a cap", async () => {
    stopProvisionalProgress();
    vi.useFakeTimers();
    startProvisionalProgress({
      fetchXp,
      loadConfig,
      refreshUserMe,
      now: () => clock,
      pollMs: 60_000,
      maxPolls: 2,
    });
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    broadcast(me());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchXp).toHaveBeenCalledTimes(1);

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    // Not while hidden.
    expect(fetchXp).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchXp).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchXp).toHaveBeenCalledTimes(3);
    // The cap: no more.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchXp).toHaveBeenCalledTimes(3);
    visibility.mockRestore();
  });

  it("stops asking once nothing is pending", async () => {
    stopProvisionalProgress();
    vi.useFakeTimers();
    startProvisionalProgress({
      fetchXp,
      loadConfig,
      refreshUserMe,
      now: () => clock,
      pollMs: 60_000,
    });
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    answers.set("g1", SCORED("g1"));
    broadcast(me());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchXp).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchXp).toHaveBeenCalledTimes(1);
  });
});

// Back-to-back games: game A left with provisional XP, then game B played and
// left before A is scored. B's figure stacks on A's.
describe("stacking pending games", () => {
  const TODAY = "2026-10-13";
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
  const entry = (extra: Partial<PendingXp>): PendingXp => ({
    gameId: "gA",
    xp: 250,
    at: T0,
    ...extra,
  });

  it("starts from where the pending games' XP takes the player", () => {
    const stacked = stackPendingXp(
      withDaily(),
      [entry({ gameId: "gA", xp: 250 })],
      config(),
    );
    expect(stacked).toMatchObject({ level: 3, xpInLevel: 40, xpForNext: 110 });
    expect(stacked.lifetimeXp).toBe(250);
  });

  it("stops at the last level across the stack", () => {
    const near: Progress = {
      ...withDaily(),
      prestige: 10,
      level: 98,
      xpInLevel: 0,
      xpForNext: 110,
    };
    const stacked = stackPendingXp(
      near,
      [entry({ gameId: "gA", xp: 150 }), entry({ gameId: "gB", xp: 400 })],
      config(),
    );
    expect(stacked).toMatchObject({
      level: 100,
      xpInLevel: 0,
      legend: false,
      canPrestige: false,
    });
  });

  it("marks the first-game bonus taken by a pending game the same day", () => {
    const stacked = stackPendingXp(
      withDaily(),
      [entry({ day: TODAY, kind: "public", firstGame: true })],
      config(),
    );
    expect(stacked.daily?.firstGameClaimed).toBe(true);
    // One that didn't take it leaves it open.
    expect(
      stackPendingXp(
        withDaily(),
        [entry({ day: TODAY, kind: "public", firstGame: false })],
        config(),
      ).daily?.firstGameClaimed,
    ).toBe(false);
  });

  it("counts pending private and singleplayer games towards the day's caps", () => {
    const stacked = stackPendingXp(
      withDaily({ privateGames: 2, singleplayerGames: 1 }),
      [
        entry({ gameId: "p1", day: TODAY, kind: "private" }),
        entry({ gameId: "p2", day: TODAY, kind: "private" }),
        entry({ gameId: "s1", day: TODAY, kind: "singleplayer" }),
      ],
      config(),
    );
    expect(stacked.daily).toMatchObject({
      privateGames: 4,
      singleplayerGames: 2,
      firstGameClaimed: false,
    });
  });

  it("starts a new UTC day from the API's counts", () => {
    const stacked = stackPendingXp(
      withDaily({ day: "2026-10-14" }),
      [
        entry({ gameId: "p1", day: TODAY, kind: "private" }),
        entry({ gameId: "a", day: TODAY, kind: "public", firstGame: true }),
      ],
      config(),
    );
    expect(stacked.daily).toMatchObject({
      day: "2026-10-14",
      privateGames: 0,
      firstGameClaimed: false,
    });
    // The XP still stacks (500: level 5): a new day resets allowances, not
    // levels.
    expect(stacked.level).toBe(5);
  });

  it("takes an older entry without a day to have used the bonus that day", () => {
    const today = stackPendingXp(withDaily(), [entry({ at: T0 })], config());
    expect(today.daily?.firstGameClaimed).toBe(true);
    // Neither cap: its kind is unknown.
    expect(today.daily?.privateGames).toBe(0);
    // Stored the UTC day before.
    const yesterday = stackPendingXp(
      withDaily(),
      [entry({ at: T0 - 13 * 3600_000 })],
      config(),
    );
    expect(yesterday.daily?.firstGameClaimed).toBe(false);
  });

  it("keeps the day, kind and bonus with the stored entry", () => {
    recordPendingXp(
      "me",
      { gameId: "gA", xp: 174, day: TODAY, kind: "private", firstGame: false },
      T0,
    );
    expect(readPendingXp("me", T0)).toEqual([
      {
        gameId: "gA",
        xp: 174,
        at: T0,
        day: TODAY,
        kind: "private",
        firstGame: false,
      },
    ]);
    // A field that doesn't read is dropped, not the entry.
    localStorage.setItem(
      PENDING_XP_KEY,
      JSON.stringify({
        me: [{ gameId: "gA", xp: 10, at: T0, day: "today", kind: "ranked" }],
      }),
    );
    expect(readPendingXp("me", T0)).toEqual([{ gameId: "gA", xp: 10, at: T0 }]);
  });

  it("applies the day's caps to the next game's figure", () => {
    // One private game used today under a cap of 2, and one pending.
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
    // Without the pending game it would still pay.
    expect(scorePrivate(withDaily({ privateGames: 1 }).daily!).eligible).toBe(
      true,
    );
    const stacked = stackPendingXp(
      withDaily({ privateGames: 1 }),
      [entry({ day: TODAY, kind: "private" })],
      config(),
    );
    expect(scorePrivate(stacked.daily!)).toEqual({
      eligible: false,
      reason: "daily_cap",
    });
  });

  describe("progressWithPendingXp", () => {
    it("asks first, counts only the unscored, and leaves out the game itself", async () => {
      recordPendingXp("me", { gameId: "gA", xp: 250, day: TODAY }, T0);
      recordPendingXp("me", { gameId: "gScored", xp: 999 }, T0);
      recordPendingXp("me", { gameId: "gUnknown", xp: 999 }, T0);
      recordPendingXp("me", { gameId: "gB", xp: 999 }, T0);
      const fetchXp = vi.fn(
        async (gameId: string): Promise<GameXpFetchResult> =>
          gameId === "gScored"
            ? {
                status: "ok",
                data: { gameId, eligible: false, reason: "too_short" },
              }
            : gameId === "gUnknown"
              ? { status: "pending" }
              : { status: "pending", notFound: true },
      );
      const start = await progressWithPendingXp({
        publicId: "me",
        progress: withDaily(),
        config: config(),
        excludeGameId: "gB",
        fetchXp,
        now: T0,
      });
      expect(fetchXp.mock.calls.map((c) => c[0]).sort()).toEqual([
        "gA",
        "gScored",
        "gUnknown",
      ]);
      expect(start).toMatchObject({ level: 3, xpInLevel: 40 });
      // The scored one is in the confirmed figure already: cleared.
      expect(readPendingXp("me", T0).map((e) => e.gameId)).toEqual([
        "gA",
        "gUnknown",
        "gB",
      ]);
    });

    it("is the confirmed progress with nothing pending", async () => {
      const progress = withDaily();
      const fetchXp = vi.fn();
      await expect(
        progressWithPendingXp({
          publicId: "me",
          progress,
          config: config(),
          excludeGameId: "gB",
          fetchXp,
          now: T0,
        }),
      ).resolves.toBe(progress);
      expect(fetchXp).not.toHaveBeenCalled();
    });
  });

  describe("in the account's level", () => {
    let answers: Map<string, GameXpFetchResult>;
    let refreshUserMe: Mock<ProvisionalDeps["refreshUserMe"]>;

    const broadcast = (progress: Progress) =>
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: {
            user: { email: "wonder@example.com" },
            player: { publicId: "me", progress },
          },
        }),
      );
    const settle = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await runCheck();
    };

    beforeEach(() => {
      answers = new Map();
      refreshUserMe = vi.fn(async () => undefined);
      startProvisionalProgress({
        fetchXp: async (gameId) =>
          answers.get(gameId) ?? { status: "pending", notFound: true },
        loadConfig: async () => config(),
        refreshUserMe,
        now: () => T0,
      });
    });

    afterEach(() => stopProvisionalProgress());

    it("stacks two pending games", async () => {
      recordPendingXp("me", { gameId: "gA", xp: 250 }, T0);
      recordPendingXp("me", { gameId: "gB", xp: 150 }, T0);
      const confirmed = { ...LEVEL_1 };
      broadcast(confirmed);
      await settle();
      // 400 XP from level 1: 100 + 110 + 110, then 80 into level 4.
      expect(provisionalProgress("me", confirmed).progress).toMatchObject({
        level: 4,
        xpInLevel: 80,
        lifetimeXp: 400,
      });
    });

    it("keeps B on top once A is scored, without counting A twice", async () => {
      recordPendingXp("me", { gameId: "gA", xp: 250 }, T0);
      recordPendingXp("me", { gameId: "gB", xp: 150 }, T0);
      broadcast({ ...LEVEL_1 });
      await settle();

      // The API scores A: the account now has A's 250 confirmed.
      const withA: Progress = {
        ...LEVEL_1,
        level: 3,
        xpInLevel: 40,
        xpForNext: 110,
        lifetimeXp: 250,
      };
      answers.set("gA", {
        status: "ok",
        data: { gameId: "gA", eligible: false, reason: "too_short" },
      });
      refreshUserMe.mockImplementation(async () => broadcast(withA));
      await settle();
      await settle();

      expect(readPendingXp("me", T0).map((e) => e.gameId)).toEqual(["gB"]);
      // Confirmed A plus pending B: 40 + 150 into level 3 is level 4 at 80,
      // the same place as before; never A's 250 again on top.
      const view = provisionalProgress("me", withA);
      expect(view.provisional).toBe(true);
      expect(view.confirmedLevel).toBe(3);
      expect(view.progress).toMatchObject({
        level: 4,
        xpInLevel: 80,
        lifetimeXp: 400,
      });
    });
  });
});
