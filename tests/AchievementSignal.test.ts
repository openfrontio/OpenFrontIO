import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerAchievement, UserMeResponse } from "../src/core/ApiSchemas";

vi.mock("../src/client/Api", () => ({
  getUserMe: vi.fn(),
  fetchUserMeUncached: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

import {
  pushEarnedAchievements,
  syncAchievements,
} from "../src/client/AchievementSignal";
import {
  fetchUserMeUncached,
  getUserMe,
  invalidateUserMe,
} from "../src/client/Api";
import { desktopAchievements } from "../src/client/DesktopAchievements";

const getUserMeMock = vi.mocked(getUserMe);
const fetchUncachedMock = vi.mocked(fetchUserMeUncached);
const invalidateUserMeMock = vi.mocked(invalidateUserMe);

// Mirrors AchievementSignal.ts's KEY, which is private to that module.
const RECORD_KEY = "achievements.pushed";

/** A shell able to receive achievements. Both the push path and the sync are
 * gated on one being present, so every test that expects either to do
 * anything has to install it. Capability is the presence of the method, not
 * the api number beside it -- that number is the shell repository's and has
 * already once meant something else entirely. `unlock` is spied over
 * separately, so nothing actually reaches this object. */
function installCapableShell() {
  (window as any).openfrontDesktop = {
    shell: { api: 4 },
    achievements: { unlock: vi.fn() },
  };
}

describe("achievement record", () => {
  beforeEach(() => {
    localStorage.clear();
    installCapableShell();
    vi.spyOn(desktopAchievements, "unlock").mockImplementation(() => undefined);
  });
  afterEach(() => {
    delete (window as any).openfrontDesktop;
    vi.restoreAllMocks();
  });

  const row = (achievement: string) => ({
    achievement,
    game: "g1",
    achievedAt: null,
  });

  it("pushes each distinct name once, however often it recurs", () => {
    const pushed = pushEarnedAchievements("p1", [
      row("win_ffa"),
      row("win_ffa"),
      row("launch_mirv"),
    ]);
    // Asserted against literal names, and before anything sorts `pushed`:
    // vitest keeps the call argument by reference, so comparing it against
    // the returned array -- the same object -- passes for any value at all.
    expect(desktopAchievements.unlock).toHaveBeenCalledWith([
      "win_ffa",
      "launch_mirv",
    ]);
    expect([...pushed].sort()).toEqual(["launch_mirv", "win_ffa"]);
  });

  it("does not record a name when no shell was there to receive it", () => {
    delete (window as any).openfrontDesktop;

    pushEarnedAchievements("p1", [row("win_ffa")]);

    // Nothing was delivered, so nothing may be marked delivered -- otherwise
    // the name is lost the moment a capable shell does arrive.
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
    installCapableShell();
    expect(pushEarnedAchievements("p1", [row("win_ffa")])).toEqual(["win_ffa"]);
  });

  // The same loss, from the direction that actually shipped: a shell whose
  // api number would have satisfied a hardcoded gate, with no namespace
  // behind it. unlock() reaches nothing, so nothing may be recorded.
  it("does not record a name for a shell that declares a high api but has no namespace", () => {
    (window as any).openfrontDesktop = { shell: { api: 99 } };

    pushEarnedAchievements("p1", [row("win_ffa")]);

    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
    installCapableShell();
    expect(pushEarnedAchievements("p1", [row("win_ffa")])).toEqual(["win_ffa"]);
  });

  it("does not re-push a name already in the record", () => {
    pushEarnedAchievements("p1", [row("win_ffa")]);
    const second = pushEarnedAchievements("p1", [
      row("win_ffa"),
      row("win_team"),
    ]);
    expect(second).toEqual(["win_team"]);
  });

  it("does not honour a record belonging to another player", () => {
    pushEarnedAchievements("p1", [row("win_ffa")]);
    const other = pushEarnedAchievements("p2", [row("win_ffa")]);
    expect(other).toEqual(["win_ffa"]);
  });

  it("survives storage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => pushEarnedAchievements("p1", [row("win_ffa")])).not.toThrow();
  });
});

// The post-game schedule syncAchievements waits through -- kept in lockstep
// with AchievementSignal.ts's POST_GAME_DELAYS_MS so these tests fail loudly
// if that schedule ever changes.
const POST_GAME_DELAYS_MS = [2_000, 5_000];

const achRow = (
  achievement: string,
  game: string | null = "g1",
): PlayerAchievement => ({ achievement, game, achievedAt: null });

function profile(rows: PlayerAchievement[], publicId = "p1"): UserMeResponse {
  return {
    user: {},
    player: {
      publicId,
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      flares: [],
      achievements: { singleplayerMap: [], player: rows },
      friends: [],
      subscription: null,
    },
  };
}

describe("syncAchievements", () => {
  beforeEach(() => {
    localStorage.clear();
    installCapableShell();
    vi.spyOn(desktopAchievements, "unlock").mockImplementation(() => undefined);
    getUserMeMock.mockReset();
    fetchUncachedMock.mockReset();
    invalidateUserMeMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    delete (window as any).openfrontDesktop;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Run the post-game poll to completion, letting every delay elapse. */
  async function runPoll(gameId: string): Promise<void> {
    const sync = syncAchievements({ gameId });
    for (const delay of POST_GAME_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    await sync;
  }

  it("startup reconcile (no gameId) reads the session's profile once and pushes what's new", async () => {
    getUserMeMock.mockResolvedValue(profile([achRow("win_ffa")]));

    await syncAchievements();

    expect(getUserMeMock).toHaveBeenCalledOnce();
    // The boot profile is already fresh; forcing a round trip for every
    // player on every launch would buy nothing.
    expect(fetchUncachedMock).not.toHaveBeenCalled();
    expect(invalidateUserMeMock).not.toHaveBeenCalled();
    expect(desktopAchievements.unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  // The session's shared profile is read by the account nav, cosmetics, the
  // store and the multiplayer join path. This runs after every game, so it
  // must not be able to leave that profile worse than it found it: it neither
  // drops the memo nor writes to it, and takes its own uncached answer.
  it("post-game poll never invalidates or reads the session's memoised profile", async () => {
    fetchUncachedMock.mockResolvedValue(profile([achRow("win_ffa", "g1")]));

    await runPoll("g1");

    expect(invalidateUserMeMock).not.toHaveBeenCalled();
    expect(getUserMeMock).not.toHaveBeenCalled();
    expect(fetchUncachedMock).toHaveBeenCalled();
  });

  it("post-game poll waits before its first attempt rather than racing ingest", async () => {
    fetchUncachedMock.mockResolvedValue(profile([achRow("win_ffa", "g1")]));

    const sync = syncAchievements({ gameId: "g1" });
    // Ingest runs inside the POST the winner vote fires, so at t=0 there is
    // provably nothing new to read and a request would be a certain miss.
    await vi.advanceTimersByTimeAsync(POST_GAME_DELAYS_MS[0] - 1);
    expect(fetchUncachedMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchUncachedMock).toHaveBeenCalledOnce();
    await sync;
  });

  it("stops as soon as the played game's row appears", async () => {
    fetchUncachedMock.mockResolvedValue(profile([achRow("win_ffa", "g2")]));

    await runPoll("g2");

    expect(fetchUncachedMock).toHaveBeenCalledOnce();
    expect(desktopAchievements.unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  // Ingest attributes a name to whichever game first earned it, so a name
  // pushed now need not carry this game's id. Having delivered something is
  // reason enough to stop.
  it("stops once an attempt has actually delivered something", async () => {
    fetchUncachedMock.mockResolvedValue(profile([achRow("win_ffa", "g0")]));

    await runPoll("g2");

    expect(fetchUncachedMock).toHaveBeenCalledOnce();
    expect(desktopAchievements.unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  // The ordinary game: the player earned nothing, so no row for it will ever
  // exist and nothing will ever be pushed. Neither exit condition can fire,
  // and the schedule is what has to bound the loop -- every client in the
  // lobby is doing this at once, against the API ingesting that same game.
  it("costs the common 'earned nothing' game a bounded number of attempts", async () => {
    fetchUncachedMock.mockResolvedValue(profile([achRow("old", "g0")]));
    // Already delivered, so no attempt can push anything.
    pushEarnedAchievements("p1", [achRow("old", "g0")]);
    vi.mocked(desktopAchievements.unlock).mockClear();

    await runPoll("g2");

    expect(fetchUncachedMock).toHaveBeenCalledTimes(POST_GAME_DELAYS_MS.length);
    expect(desktopAchievements.unlock).not.toHaveBeenCalled();
  });

  // getUserMe's contract answers `false` for signed out, a 401, a 500, a
  // dropped connection and a self-imposed timeout alike, and cannot tell them
  // apart. Concluding "signed out" and returning would abandon the poll on a
  // single blip, so a falsy answer is retried within the budget.
  it("retries a failed attempt instead of concluding the player is signed out", async () => {
    fetchUncachedMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(profile([achRow("win_ffa", "g2")]));

    await runPoll("g2");

    expect(fetchUncachedMock).toHaveBeenCalledTimes(2);
    expect(desktopAchievements.unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  it("gives up after the budget without throwing, and records nothing", async () => {
    fetchUncachedMock.mockResolvedValue(false);

    const sync = syncAchievements({ gameId: "never-arrives" });
    for (const delay of POST_GAME_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    await expect(sync).resolves.toBeUndefined();

    expect(fetchUncachedMock).toHaveBeenCalledTimes(POST_GAME_DELAYS_MS.length);
    expect(desktopAchievements.unlock).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
  });

  it("does nothing when the startup reconcile finds no session, and does not throw", async () => {
    getUserMeMock.mockResolvedValue(false);

    await expect(syncAchievements()).resolves.toBeUndefined();

    expect(desktopAchievements.unlock).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
  });

  // The record is only safe to write when something received the names. With
  // no capable shell the sync must not run at all -- not fetch, and above all
  // not record. A version that merely skipped `unlock` would still poison the
  // record and silently cost the player every achievement earned in the
  // meantime, so the storage assertion is the one that matters here.
  it.each([
    ["no bridge at all", undefined],
    ["a shell with no achievements namespace", { shell: { api: 3 } }],
    // The case that shipped: the api number a hardcoded gate would have
    // accepted, with nothing behind it. Every shell in the wild is this.
    ["a shell declaring an api past the gate", { shell: { api: 99 } }],
    [
      "a namespace whose unlock is not callable",
      { shell: { api: 99 }, achievements: { unlock: undefined } },
    ],
  ])("does not fetch or record with %s", async (_label, bridge) => {
    if (bridge === undefined) {
      delete (window as any).openfrontDesktop;
    } else {
      (window as any).openfrontDesktop = bridge;
    }
    getUserMeMock.mockResolvedValue(profile([achRow("win_ffa")]));
    fetchUncachedMock.mockResolvedValue(profile([achRow("win_ffa")]));

    await syncAchievements();
    await runPoll("g1");

    expect(getUserMeMock).not.toHaveBeenCalled();
    expect(fetchUncachedMock).not.toHaveBeenCalled();
    expect(invalidateUserMeMock).not.toHaveBeenCalled();
    expect(desktopAchievements.unlock).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
  });
});
