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
  applyGameXp,
  clearPendingXp,
  MAX_PENDING_PER_ACCOUNT,
  PENDING_XP_CHECKED_KEY,
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
  scoredGames,
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

  it("expires an entry after 12 hours", () => {
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

  it("prunes scored games first when over the cap", () => {
    for (let i = 0; i < MAX_PENDING_PER_ACCOUNT; i++) {
      recordPendingXp("me", { gameId: `g${i}`, xp: 10 }, T0 + i);
    }
    // g5 is scored: the API has it, so it goes before the oldest unscored.
    const raw = JSON.parse(localStorage.getItem(PENDING_XP_KEY)!);
    raw.me[5].scored = { xp: 10, lifetimeAfter: 10 };
    localStorage.setItem(PENDING_XP_KEY, JSON.stringify(raw));
    recordPendingXp("me", { gameId: "new", xp: 10 }, T0 + 100);
    const kept = readPendingXp("me", T0 + 100).map((e) => e.gameId);
    expect(kept).toHaveLength(MAX_PENDING_PER_ACCOUNT);
    expect(kept).not.toContain("g5");
    expect(kept[0]).toBe("g0");
  });

  it("marks an eligible answer scored and drops an ineligible one", () => {
    recordPendingXp("me", { gameId: "gA", xp: 250 }, T0);
    recordPendingXp("me", { gameId: "gB", xp: 50 }, T0);
    applyGameXp(
      "me",
      {
        gameId: "gA",
        eligible: true,
        breakdown: {
          leftEarly: false,
          played: 260,
          time: 0,
          placement: 0,
          win: 0,
          firstGame: 0,
          feats: 0,
          subtotal: 260,
          gamePermille: 1000,
          subscriberPermille: 1000,
          total: 260,
        },
        before: { prestige: 0, level: 1, xpInLevel: 0, xpForNext: 100 },
        after: { ...LEVEL_1, lifetimeXp: 260 },
        levelsReached: [],
      },
      T0,
    );
    applyGameXp(
      "me",
      { gameId: "gB", eligible: false, reason: "too_short" },
      T0,
    );
    expect(readPendingXp("me", T0)).toEqual([
      {
        gameId: "gA",
        xp: 250,
        at: T0,
        scored: { xp: 260, lifetimeAfter: 260 },
      },
    ]);
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

// A scored answer, as GET /users/@me/xp/:gameId gives it: `xp` awarded,
// taking the player from `from` (lifetime XP) to `from + xp`.
function scoredAnswer(gameId: string, xp: number, from = 0): GameXpFetchResult {
  return {
    status: "ok",
    data: {
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
    },
  };
}

const NOT_SCORED: GameXpFetchResult = { status: "pending", notFound: true };
const INELIGIBLE = (gameId: string): GameXpFetchResult => ({
  status: "ok",
  data: { gameId, eligible: false, reason: "too_short" },
});

// The account at level 3 with 40 of 110: level 1 at 0 plus 250.
const AT_250: Progress = {
  ...LEVEL_1,
  level: 3,
  xpInLevel: 40,
  xpForNext: 110,
  lifetimeXp: 250,
};

describe("provisionalProgress", () => {
  let answers: Map<string, GameXpFetchResult | (() => GameXpFetchResult)>;
  let fetchXp: Mock<ProvisionalDeps["fetchXp"]>;
  let loadConfig: Mock<ProvisionalDeps["loadConfig"]>;
  let readUserMe: Mock<ProvisionalDeps["readUserMe"]>;
  let clock: number;

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

  // Lets the checks already started finish.
  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  }

  // Runs a check (a poll), and lets it finish.
  async function check(): Promise<void> {
    await runCheck();
    await settle();
  }

  const view = (progress: Progress) => provisionalProgress("me", progress);
  const ids = () => readPendingXp("me", clock).map((e) => e.gameId);

  function start(over: Partial<ProvisionalDeps> = {}): void {
    startProvisionalProgress({
      fetchXp,
      loadConfig,
      readUserMe,
      now: () => clock,
      ...over,
    });
  }

  beforeEach(() => {
    clock = T0;
    answers = new Map();
    fetchXp = vi.fn(async (gameId: string) => {
      const answer = answers.get(gameId) ?? NOT_SCORED;
      return typeof answer === "function" ? answer() : answer;
    });
    loadConfig = vi.fn(async () => config());
    readUserMe = vi.fn(async () => false as const);
    start();
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
    expect(view(LEVEL_1).provisional).toBe(false);
    await settle();
    expect(fetchXp).toHaveBeenCalledWith("g1");
    const shown = view(response.player.progress!);
    expect(shown.provisional).toBe(true);
    expect(shown.confirmedLevel).toBe(1);
    expect(shown.progress).toMatchObject({
      level: 3,
      xpInLevel: 40,
      xpForNext: 110,
    });
    // The same object while nothing changes.
    expect(view(response.player.progress!)).toBe(shown);
  });

  it("counts a game stored at death on the figure it was worked out from, unasked", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250, notIn: 0 }, T0);
    stopProvisionalProgress();
    start();
    broadcast(me());
    await settle();
    expect(fetchXp).not.toHaveBeenCalled();
    expect(view(LEVEL_1).progress).toMatchObject({ level: 3, xpInLevel: 40 });
  });

  it("adds every pending game", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 100 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: 150 }, T0);
    const response = me();
    broadcast(response);
    await settle();
    expect(view(response.player.progress!).progress).toMatchObject({
      level: 3,
      xpInLevel: 40,
    });
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

  it("doesn't count an unscored game onto a figure newer than the last check", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    broadcast(me());
    await settle();
    // A figure with more lifetime XP may already include the game.
    const fresher: Progress = { ...LEVEL_1, lifetimeXp: 10, xpInLevel: 10 };
    expect(view(fresher)).toEqual({
      progress: fresher,
      provisional: false,
      confirmedLevel: 1,
    });
    // Until a check after it says the game still isn't scored.
    await settle();
    expect(view(fresher).progress).toMatchObject({ level: 3, xpInLevel: 50 });
  });

  describe("a scored game", () => {
    beforeEach(async () => {
      recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
      broadcast(me());
      await settle();
      answers.set("g1", scoredAnswer("g1", 260));
    });

    it("is kept, marked with the API's XP and the lifetime it took the player to", async () => {
      await check();
      expect(readPendingXp("me", clock)).toEqual([
        expect.objectContaining({
          gameId: "g1",
          scored: { xp: 260, lifetimeAfter: 260 },
        }),
      ]);
      // Never asked about again.
      fetchXp.mockClear();
      await check();
      expect(fetchXp).not.toHaveBeenCalled();
    });

    it("counts onto a stale figure as confirmed XP, not provisional", async () => {
      await check();
      // A replica still from before the game: lifetime below 260.
      const shown = view({ ...LEVEL_1 });
      expect(shown.provisional).toBe(false);
      expect(shown.confirmedLevel).toBe(3);
      expect(shown.progress).toMatchObject({
        level: 3,
        xpInLevel: 50,
        lifetimeXp: 260,
      });
    });

    it("isn't counted onto a figure that includes it", async () => {
      await check();
      const fresh: Progress = { ...AT_250, xpInLevel: 50, lifetimeXp: 260 };
      expect(view(fresh)).toEqual({
        progress: fresh,
        provisional: false,
        confirmedLevel: 3,
      });
    });

    it("isn't counted twice when the account can't be re-read after it", async () => {
      // A figure read after the API scored it (another view's re-read) shows
      // before the check marks it: newer than the last check, it isn't
      // counted on.
      const readAfterScoring: Progress = {
        ...AT_250,
        xpInLevel: 50,
        lifetimeXp: 260,
      };
      expect(view(readAfterScoring).progress).toBe(readAfterScoring);
      for (const failure of [
        async () => false as const,
        async () => Promise.reject(new Error("offline")),
      ]) {
        readUserMe.mockImplementationOnce(failure);
        await check();
        // Level 3, never 5.
        expect(view(readAfterScoring).progress).toBe(readAfterScoring);
        // The figure from before still shows the game, as confirmed XP.
        expect(view({ ...LEVEL_1 }).progress).toMatchObject({
          level: 3,
          xpInLevel: 50,
        });
      }
    });

    it("reads the account afresh, broadcasts it, and names the game", async () => {
      readUserMe.mockResolvedValue(
        me({ ...AT_250, xpInLevel: 50, lifetimeXp: 260 }),
      );
      const changed = vi.fn();
      const users = vi.fn();
      document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
      document.addEventListener("userMeResponse", users);
      try {
        await check();
        expect(readUserMe).toHaveBeenCalledTimes(1);
        expect(users).toHaveBeenCalledTimes(1);
        expect(
          changed.mock.calls.map(([event]) => scoredGames(event as Event)),
        ).toContainEqual(["g1"]);
      } finally {
        document.removeEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
        document.removeEventListener("userMeResponse", users);
      }
    });
  });

  it("drops a game the API ruled ineligible, and counts nothing for it", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    broadcast(me());
    await settle();
    answers.set("g1", INELIGIBLE("g1"));
    await check();
    expect(readPendingXp("me", clock)).toEqual([]);
    expect(view({ ...LEVEL_1 }).provisional).toBe(false);
    expect(view({ ...LEVEL_1 }).progress.level).toBe(1);
    expect(readUserMe).not.toHaveBeenCalled();
  });

  it("never flickers when one of several games is scored", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: 30 }, T0);
    let shownFigure: Progress = { ...LEVEL_1 };
    broadcast(me(shownFigure));
    await settle();
    // 280 XP from level 1 at 0: level 3 with 70.
    expect(view(shownFigure).progress).toMatchObject({
      level: 3,
      xpInLevel: 70,
    });

    // What the account menu shows at every change, from here on.
    const levels: string[] = [];
    const record = () => {
      const p = view(shownFigure).progress;
      levels.push(`${p.level}:${p.xpInLevel}`);
    };
    const onUser = (e: Event) => {
      shownFigure = (e as CustomEvent<UserMeResponse>).detail.player.progress!;
      record();
    };
    document.addEventListener("userMeResponse", onUser);
    document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, record);
    try {
      // g1 is scored at 250; the fresh account includes it.
      answers.set("g1", scoredAnswer("g1", 250));
      readUserMe.mockResolvedValue(me({ ...AT_250 }));
      await check();
      expect(levels.length).toBeGreaterThan(0);
      expect(new Set(levels)).toEqual(new Set(["3:70"]));
      // g2 was asked about again before the new figure was shown.
      expect(fetchXp.mock.calls.map((c) => c[0])).toEqual([
        "g1",
        "g2",
        "g1",
        "g2",
        "g2",
      ]);
      const shown = view(shownFigure);
      expect(shown.provisional).toBe(true);
      expect(shown.confirmedLevel).toBe(3);
    } finally {
      document.removeEventListener("userMeResponse", onUser);
      document.removeEventListener(PROVISIONAL_PROGRESS_CHANGED, record);
    }
  });

  it("stops at a rate limit, and keeps the level where it was", async () => {
    for (const id of ["g1", "g2", "g3"]) {
      recordPendingXp("me", { gameId: id, xp: 100 }, T0);
    }
    const figure = { ...LEVEL_1 };
    broadcast(me(figure));
    await settle();
    const before = view(figure).progress;
    expect(before).toMatchObject({ level: 3, xpInLevel: 90 });

    fetchXp.mockClear();
    answers.set("g1", { status: "pending", rateLimited: true });
    await check();
    // The round stopped at the first 429.
    expect(fetchXp).toHaveBeenCalledTimes(1);
    expect(view(figure).progress).toMatchObject({ level: 3, xpInLevel: 90 });

    // A failure or a refused session keeps the game's last verdict too.
    answers.set("g1", { status: "pending" });
    answers.set("g2", { status: "unavailable" });
    answers.set("g3", () => {
      throw new Error("network down");
    });
    await check();
    expect(view(figure).progress).toMatchObject({ level: 3, xpInLevel: 90 });
    expect(ids()).toEqual(["g1", "g2", "g3"]);
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
      recordPendingXp("me", { gameId: `g${i}`, xp: 10 }, T0);
    }
    broadcast(me());
    await settle();
    expect(fetchXp).toHaveBeenCalledTimes(5);
    expect(most).toBe(1);
  });

  it("follows another tab's answers through storage", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    recordPendingXp("me", { gameId: "g2", xp: 30 }, T0);
    const figure = { ...LEVEL_1 };
    broadcast(me(figure));
    await settle();
    readUserMe.mockResolvedValue(me({ ...AT_250 }));
    const changed = vi.fn();
    const users = vi.fn();
    document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
    document.addEventListener("userMeResponse", users);
    try {
      fetchXp.mockClear();
      // The other tab: g1 scored at 250, written to storage.
      const raw = JSON.parse(localStorage.getItem(PENDING_XP_KEY)!);
      raw.me[0].scored = { xp: 250, lifetimeAfter: 250 };
      localStorage.setItem(PENDING_XP_KEY, JSON.stringify(raw));
      window.dispatchEvent(
        new StorageEvent("storage", { key: PENDING_XP_KEY }),
      );
      // This tab's figure from before holds its level: no reload needed.
      expect(view(figure).progress).toMatchObject({
        level: 3,
        xpInLevel: 70,
      });
      expect(
        changed.mock.calls.map(([event]) => scoredGames(event as Event)),
      ).toContainEqual(["g1"]);
      await settle();
      // And it reads the account afresh, without asking the API itself
      // about g1.
      expect(readUserMe).toHaveBeenCalledTimes(1);
      expect(users).toHaveBeenCalled();
      expect(fetchXp.mock.calls.map((c) => c[0])).not.toContain("g1");
    } finally {
      document.removeEventListener(PROVISIONAL_PROGRESS_CHANGED, changed);
      document.removeEventListener("userMeResponse", users);
    }
  });

  it("keeps but doesn't count a game it couldn't ask about", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    answers.set("g1", { status: "pending" });
    const response = me();
    broadcast(response);
    await settle();
    expect(view(response.player.progress!).provisional).toBe(false);
    expect(readPendingXp("me", clock)).toHaveLength(1);
    answers.set("g1", { status: "unavailable" });
    await check();
    expect(view(response.player.progress!).provisional).toBe(false);
    expect(readPendingXp("me", clock)).toHaveLength(1);
    expect(readUserMe).not.toHaveBeenCalled();
  });

  it("shows the confirmed figures without a config", async () => {
    loadConfig.mockResolvedValue(false);
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    const response = me();
    broadcast(response);
    await settle();
    expect(view(response.player.progress!).provisional).toBe(false);
  });

  it("drops an expired entry without asking about it", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    clock = T0 + PENDING_XP_TTL_MS;
    const response = me();
    broadcast(response);
    await settle();
    expect(fetchXp).not.toHaveBeenCalled();
    expect(view(response.player.progress!).provisional).toBe(false);
  });

  it("forgets the account when the session goes", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    const response = me();
    broadcast(response);
    await settle();
    document.dispatchEvent(new CustomEvent("session-cleared"));
    expect(view(response.player.progress!).provisional).toBe(false);
    broadcast(false);
    expect(view(response.player.progress!).provisional).toBe(false);
  });

  describe("polling", () => {
    beforeEach(() => {
      stopProvisionalProgress();
      vi.useFakeTimers();
      vi.setSystemTime(T0);
    });

    const startPolling = (maxPolls?: number) =>
      startProvisionalProgress({
        fetchXp,
        loadConfig,
        readUserMe,
        pollMs: 60_000,
        maxPolls,
      });

    it("asks again every minute while the page shows, up to a cap", async () => {
      startPolling(2);
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

    it("skips its poll when another tab asked within the interval", async () => {
      startPolling();
      recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
      broadcast(me());
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchXp).toHaveBeenCalledTimes(1);
      const visibility = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("visible");
      try {
        // Another tab asks half a minute in.
        await vi.advanceTimersByTimeAsync(30_000);
        localStorage.setItem(
          PENDING_XP_CHECKED_KEY,
          JSON.stringify({ me: Date.now() }),
        );
        await vi.advanceTimersByTimeAsync(30_000);
        // This tab's tick, 30s after the other tab's: skipped.
        expect(fetchXp).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchXp).toHaveBeenCalledTimes(2);
      } finally {
        visibility.mockRestore();
      }
    });

    it("stops asking once nothing is unscored", async () => {
      startPolling();
      recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
      answers.set("g1", scoredAnswer("g1", 250));
      broadcast(me());
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchXp).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetchXp).toHaveBeenCalledTimes(1);
    });
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

  it("leaves the allowances alone for an entry without a day", () => {
    const stacked = stackPendingXp(
      withDaily(),
      [entry({ kind: "private", firstGame: true })],
      config(),
    );
    expect(stacked.daily).toMatchObject({
      privateGames: 0,
      firstGameClaimed: false,
    });
    expect(stacked.level).toBe(3);
  });

  it("counts a scored game's own XP, and its allowances", () => {
    const stacked = stackPendingXp(
      withDaily(),
      [
        entry({
          xp: 250,
          day: TODAY,
          kind: "public",
          firstGame: true,
          scored: { xp: 100, lifetimeAfter: 100 },
        }),
      ],
      config(),
    );
    expect(stacked).toMatchObject({ level: 2, xpInLevel: 0 });
    expect(stacked.daily?.firstGameClaimed).toBe(true);
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
    let readUserMe: Mock<ProvisionalDeps["readUserMe"]>;

    const me = (progress: Progress) =>
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

    beforeEach(() => {
      answers = new Map();
      readUserMe = vi.fn(async () => false as const);
      startProvisionalProgress({
        fetchXp: async (gameId) =>
          answers.get(gameId) ?? { status: "pending", notFound: true },
        loadConfig: async () => config(),
        readUserMe,
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
      const before = { ...LEVEL_1 };
      broadcast(before);
      await settle();

      // The API scores A at 250: the account now has it confirmed.
      const withA: Progress = {
        ...LEVEL_1,
        level: 3,
        xpInLevel: 40,
        xpForNext: 110,
        lifetimeXp: 250,
      };
      answers.set("gA", {
        status: "ok",
        data: {
          gameId: "gA",
          eligible: true,
          breakdown: {
            leftEarly: false,
            played: 250,
            time: 0,
            placement: 0,
            win: 0,
            firstGame: 0,
            feats: 0,
            subtotal: 250,
            gamePermille: 1000,
            subscriberPermille: 1000,
            total: 250,
          },
          before: { prestige: 0, level: 1, xpInLevel: 0, xpForNext: 100 },
          after: { ...withA, canPrestige: false },
          levelsReached: [],
        },
      });
      readUserMe.mockResolvedValue(me(withA));
      await runCheck();
      await settle();

      const entries = readPendingXp("me", T0);
      expect(entries.map((e) => [e.gameId, e.scored !== undefined])).toEqual([
        ["gA", true],
        ["gB", false],
      ]);
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
      // The figure from before A too: the same place.
      expect(provisionalProgress("me", before).progress).toMatchObject({
        level: 4,
        xpInLevel: 80,
      });
    });
  });
});

describe("storage that won't keep the answers", () => {
  afterEach(() => {
    stopProvisionalProgress();
    vi.restoreAllMocks();
  });

  it("doesn't start a loop of checks", async () => {
    recordPendingXp("me", { gameId: "g1", xp: 250 }, T0);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const fetchXp = vi.fn(
      async (): Promise<GameXpFetchResult> => ({
        status: "pending",
        notFound: true,
      }),
    );
    startProvisionalProgress({
      fetchXp,
      loadConfig: async () => config(),
      readUserMe: async () => false,
      now: () => T0,
    });
    const figure = { ...LEVEL_1 };
    // Every change re-renders, and every render reads the figure again.
    const render = () => provisionalProgress("me", figure);
    document.addEventListener(PROVISIONAL_PROGRESS_CHANGED, render);
    try {
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: { user: {}, player: { publicId: "me", progress: figure } },
        }),
      );
      for (let i = 0; i < 5; i++) {
        render();
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(fetchXp).toHaveBeenCalledTimes(1);
      // Uncounted rather than guessed at: the answer couldn't be kept.
      expect(render().provisional).toBe(false);
    } finally {
      document.removeEventListener(PROVISIONAL_PROGRESS_CHANGED, render);
    }
  });
});
