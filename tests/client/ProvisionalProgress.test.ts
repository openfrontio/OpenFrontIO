import type {
  Progress,
  ProgressionConfig,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
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
  projectPendingXp,
  PROVISIONAL_PROGRESS_CHANGED,
  type ProvisionalDeps,
  provisionalProgress,
  readPendingXp,
  recordPendingXp,
  runCheck,
  startProvisionalProgress,
  stopProvisionalProgress,
} from "../../src/client/ProvisionalProgress";

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
