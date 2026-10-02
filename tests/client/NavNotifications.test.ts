import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchFriendRequests,
  getCosmeticsHash,
  getGamesPlayed,
  getUserProfile,
  isOnCrazyGames,
  latestUserMeResponse,
} = vi.hoisted(() => ({
  fetchFriendRequests: vi.fn(),
  getCosmeticsHash: vi.fn(async () => "hash-2"),
  getGamesPlayed: vi.fn(() => 0),
  getUserProfile: vi.fn(async () => null),
  isOnCrazyGames: vi.fn(() => false),
  latestUserMeResponse: vi.fn(),
}));

vi.mock("../../src/client/Cosmetics", () => ({ getCosmeticsHash }));
vi.mock("../../src/client/Utils", () => ({ getGamesPlayed }));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { getUserProfile, isOnCrazyGames },
}));
vi.mock("../../src/client/NavAccountButton", () => ({ latestUserMeResponse }));
vi.mock("../../src/client/FriendsApi", () => ({
  fetchFriendRequests,
  FRIEND_REQUESTS_UPDATED_EVENT: "friend-requests-updated",
  publishFriendRequests: (requests: unknown) =>
    document.dispatchEvent(
      new CustomEvent("friend-requests-updated", { detail: requests }),
    ),
}));
vi.mock("resources/version.txt?raw", () => ({ default: "v9.9.9" }));

import {
  NavNotificationsController,
  navNotifications,
} from "../../src/client/components/NavNotificationsController";

const linkedUser = {
  user: { email: "player@example.com" },
  player: { publicId: "me" },
} as never;

const pendingRequest = {
  publicId: "friend.1234",
  username: "friend.1234",
  createdAt: "2026-10-02T12:00:00.000Z",
};

// Two components with their own controller — the bell lives in
// <nav-utility-icons>, the store dot in the nav bars.
function host() {
  const requestUpdate = vi.fn();
  const stub = {
    requestUpdate,
    addController: () => {},
    removeController: () => {},
    updateComplete: Promise.resolve(true),
  };
  const controller = new NavNotificationsController(stub as never);
  controller.hostConnected();
  return { controller, requestUpdate };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("nav notifications", () => {
  beforeEach(() => {
    navNotifications.reset();
    localStorage.clear();
    latestUserMeResponse.mockReturnValue(false);
    fetchFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] });
    // Seen an older version and an older cosmetics hash: news and store both
    // have something new.
    localStorage.setItem("newsSeenVersion", "v9.9.8");
    localStorage.setItem("storeSeenHash", "hash-1");
  });

  afterEach(() => {
    navNotifications.reset();
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shares state across components, so reading the release reveals the store dot", async () => {
    const bell = host();
    const navBar = host();
    await flush();

    // Bell notifications outrank store, so only the bell shows a dot.
    expect(bell.controller.showBellDot()).toBe(true);
    expect(navBar.controller.showStoreDot()).toBe(false);

    bell.controller.markVersionSeen();

    expect(bell.controller.showBellDot()).toBe(false);
    expect(navBar.controller.showStoreDot()).toBe(true);
    // Both components re-render off the shared state.
    expect(navBar.requestUpdate).toHaveBeenCalled();
  });

  it("keeps pending friend requests on the bell until the request is resolved", async () => {
    latestUserMeResponse.mockReturnValue(linkedUser);
    fetchFriendRequests.mockResolvedValue({
      incoming: [pendingRequest],
      outgoing: [],
    });
    const bell = host();
    await navNotifications.refreshFriendRequests();

    expect(bell.controller.friendRequests()).toEqual([pendingRequest]);
    bell.controller.markVersionSeen();
    expect(bell.controller.showBellDot()).toBe(true);

    document.dispatchEvent(
      new CustomEvent("friend-requests-updated", {
        detail: { incoming: [], outgoing: [] },
      }),
    );
    expect(bell.controller.showBellDot()).toBe(false);
  });

  it("uses one poller for every nav host and refreshes on focus", async () => {
    vi.useFakeTimers();
    latestUserMeResponse.mockReturnValue(linkedUser);
    host();
    host();
    await flush();

    expect(fetchFriendRequests).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchFriendRequests).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(fetchFriendRequests).toHaveBeenCalledTimes(3);
  });

  it("does not poll signed-out players and stops after logout", async () => {
    latestUserMeResponse.mockReturnValue(false);
    host();
    await flush();
    expect(fetchFriendRequests).not.toHaveBeenCalled();

    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: linkedUser }),
    );
    await flush();
    expect(fetchFriendRequests).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: false }),
    );
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(fetchFriendRequests).toHaveBeenCalledTimes(1);
  });

  it("preserves the last successful requests when a refresh fails", async () => {
    latestUserMeResponse.mockReturnValue(linkedUser);
    fetchFriendRequests
      .mockResolvedValueOnce({ incoming: [pendingRequest], outgoing: [] })
      .mockResolvedValueOnce(false);
    const bell = host();
    await navNotifications.refreshFriendRequests();

    window.dispatchEvent(new Event("focus"));
    await flush();

    expect(bell.controller.friendRequests()).toEqual([pendingRequest]);
  });

  it("does not overlap refreshes for one account or apply a stale account response", async () => {
    let resolveFirst!: (value: {
      incoming: (typeof pendingRequest)[];
      outgoing: never[];
    }) => void;
    fetchFriendRequests
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ incoming: [], outgoing: [] });
    latestUserMeResponse.mockReturnValue(linkedUser);
    const bell = host();

    window.dispatchEvent(new Event("focus"));
    expect(fetchFriendRequests).toHaveBeenCalledTimes(1);

    const nextUser = {
      user: { email: "other@example.com" },
      player: { publicId: "other" },
    } as never;
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: nextUser }),
    );
    await flush();
    expect(fetchFriendRequests).toHaveBeenCalledTimes(2);

    resolveFirst({ incoming: [pendingRequest], outgoing: [] });
    await flush();
    expect(bell.controller.friendRequests()).toEqual([]);
  });

  it("keeps help last in the priority chain", async () => {
    const bell = host();
    await flush();

    expect(bell.controller.showHelpDot()).toBe(false);
    bell.controller.markVersionSeen();
    expect(bell.controller.showHelpDot()).toBe(false); // store still pending
    bell.controller.onStoreClick();
    expect(bell.controller.showHelpDot()).toBe(true);
  });
});
