import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerAchievement, UserMeResponse } from "../src/core/ApiSchemas";

vi.mock("../src/client/Api", () => ({
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

import {
  pushEarnedAchievements,
  syncAchievements,
} from "../src/client/AchievementSignal";
import { getUserMe, invalidateUserMe } from "../src/client/Api";
import { desktopAchievements } from "../src/client/DesktopAchievements";

const getUserMeMock = vi.mocked(getUserMe);
const invalidateUserMeMock = vi.mocked(invalidateUserMe);

// Mirrors AchievementSignal.ts's KEY, which is private to that module.
const RECORD_KEY = "achievements.pushed";

/** A shell new enough to receive achievements. Both the push path and the
 * sync are gated on one being present, so every test that expects either to
 * do anything has to install it. `unlock` is spied over separately, so
 * nothing actually reaches this object. */
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

// The retry delays syncAchievements schedules between attempts when a
// gameId is given -- kept in lockstep with AchievementSignal.ts's
// RETRY_DELAYS_MS so these tests fail loudly if that schedule ever changes.
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

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
    invalidateUserMeMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    delete (window as any).openfrontDesktop;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("startup reconcile (no gameId) does one fetch, pushes what's new, and does not invalidate the already-fresh cache", async () => {
    getUserMeMock.mockResolvedValue(profile([achRow("win_ffa")]));

    await syncAchievements();

    expect(getUserMeMock).toHaveBeenCalledOnce();
    expect(invalidateUserMeMock).not.toHaveBeenCalled();
    expect(desktopAchievements.unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  it("post-game poll (gameId given) invalidates the stale cache before fetching", async () => {
    getUserMeMock.mockResolvedValue(profile([achRow("win_ffa", "g1")]));

    await syncAchievements({ gameId: "g1" });

    expect(invalidateUserMeMock).toHaveBeenCalledOnce();
    expect(getUserMeMock).toHaveBeenCalledOnce();
  });

  it("stops polling as soon as the played game's row appears", async () => {
    getUserMeMock
      .mockResolvedValueOnce(profile([achRow("unrelated", "g0")]))
      .mockResolvedValueOnce(profile([achRow("unrelated", "g0")]))
      .mockResolvedValueOnce(profile([achRow("win_ffa", "g2")]));

    const sync = syncAchievements({ gameId: "g2" });
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
    await sync;

    // Third attempt matched -- never reached the third retry delay.
    expect(getUserMeMock).toHaveBeenCalledTimes(3);
    expect(invalidateUserMeMock).toHaveBeenCalledTimes(3);
    expect(desktopAchievements.unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  it("gives up after the retry budget without throwing", async () => {
    getUserMeMock.mockResolvedValue(profile([achRow("unrelated", "g0")]));

    const sync = syncAchievements({ gameId: "never-arrives" });
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    await vi.advanceTimersByTimeAsync(total);
    await expect(sync).resolves.toBeUndefined();

    // 1 initial attempt + one per retry delay, and not one more.
    expect(getUserMeMock).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length);
    expect(desktopAchievements.unlock).not.toHaveBeenCalled();
  });

  it("recovers from a network failure on an earlier attempt", async () => {
    getUserMeMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(profile([achRow("win_ffa", "g2")]));

    const sync = syncAchievements({ gameId: "g2" });
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    await sync;

    expect(desktopAchievements.unlock).toHaveBeenCalledWith(["win_ffa"]);
  });

  it("does nothing when signed out, and does not throw", async () => {
    getUserMeMock.mockResolvedValue(false);

    await expect(syncAchievements()).resolves.toBeUndefined();

    expect(desktopAchievements.unlock).not.toHaveBeenCalled();
  });

  // The record is only safe to write when something received the names. With
  // no capable shell the sync must not run at all -- not fetch, and above all
  // not record. A version that merely skipped `unlock` would still poison the
  // record and silently cost the player every achievement earned in the
  // meantime, so the storage assertion is the one that matters here.
  it.each([
    ["no bridge at all", undefined],
    ["a shell too old to take achievements", { shell: { api: 3 } }],
    [
      "an old shell that exposes the namespace anyway",
      { shell: { api: 3 }, achievements: { unlock: () => undefined } },
    ],
  ])("does not fetch or record with %s", async (_label, bridge) => {
    if (bridge === undefined) {
      delete (window as any).openfrontDesktop;
    } else {
      (window as any).openfrontDesktop = bridge;
    }
    getUserMeMock.mockResolvedValue(profile([achRow("win_ffa")]));

    await syncAchievements();
    await syncAchievements({ gameId: "g1" });

    expect(getUserMeMock).not.toHaveBeenCalled();
    expect(invalidateUserMeMock).not.toHaveBeenCalled();
    expect(desktopAchievements.unlock).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECORD_KEY)).toBeNull();
  });
});
