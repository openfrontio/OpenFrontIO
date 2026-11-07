import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  acceptFriendRequest,
  deleteFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  nextFriendRequestsSeq,
  publishFriendRequests,
} = vi.hoisted(() => {
  let seq = 0;
  return {
    acceptFriendRequest: vi.fn(async () => true as const),
    deleteFriendRequest: vi.fn(async () => true as const),
    fetchFriendRequests: vi.fn(),
    fetchFriends: vi.fn(),
    nextFriendRequestsSeq: () => ++seq,
    // Dispatch like the real one: the tab applies its own fetches through the
    // event it listens to. The calls are still recorded.
    publishFriendRequests: vi.fn(
      (requests: { incoming: unknown[]; outgoing: unknown[] }, at: number) =>
        document.dispatchEvent(
          new CustomEvent("friend-requests-updated", {
            detail: { ...requests, seq: at },
          }),
        ),
    ),
  };
});

vi.mock("../../../src/client/FriendsApi", () => ({
  acceptFriendRequest,
  deleteFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  FRIEND_REQUESTS_UPDATED_EVENT: "friend-requests-updated",
  nextFriendRequestsSeq,
  publishFriendRequests,
  removeFriend: vi.fn(),
  sendFriendRequest: vi.fn(),
}));
vi.mock("../../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => true),
}));
vi.mock("../../../src/client/Utils", () => ({
  showToast: vi.fn(),
  translateText: (key: string) => key,
}));
vi.mock("../../../src/client/components/ui/PlayerNameLink", () => ({
  playerNameLink: (_host: unknown, username: string | null, publicId: string) =>
    username ?? publicId,
}));

import "../../../src/client/components/FriendsList";

const pendingRequest = {
  publicId: "friend.1234",
  username: "friend.1234",
  createdAt: "2026-10-02T12:00:00.000Z",
};

const newerRequest = {
  publicId: "newer.9999",
  username: "newer.9999",
  createdAt: "2026-10-02T15:00:00.000Z",
};

const otherAccountRequest = {
  publicId: "other.5678",
  username: "other.5678",
  createdAt: "2026-10-02T14:00:00.000Z",
};

// Main re-broadcasts userMeResponse when auth is re-resolved, e.g. after a
// portal sign-in switches the page to another account without a reload.
function switchAccount(): void {
  document.dispatchEvent(
    new CustomEvent("userMeResponse", {
      detail: { user: {}, player: { publicId: "other" } },
    }),
  );
}

type FriendsElement = HTMLElement & { updateComplete: Promise<unknown> };

async function settle(element: FriendsElement): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
}

async function mount(): Promise<FriendsElement> {
  const element = document.createElement("friends-list") as FriendsElement;
  document.body.appendChild(element);
  await settle(element);
  return element;
}

function button(element: ParentNode, key: string): HTMLButtonElement {
  return Array.from(element.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(key),
  )!;
}

describe("FriendsList notification synchronization", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    fetchFriendRequests.mockResolvedValue({
      incoming: [pendingRequest],
      outgoing: [],
    });
    fetchFriends.mockResolvedValue({
      results: [],
      total: 0,
      page: 1,
      limit: 20,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("publishes the initial server snapshot and an immediate update after accept", async () => {
    const element = await mount();
    expect(publishFriendRequests).toHaveBeenCalledWith(
      { incoming: [pendingRequest], outgoing: [] },
      expect.any(Number),
    );
    publishFriendRequests.mockClear();

    button(element, "friends.accept").click();
    await settle(element);

    expect(acceptFriendRequest).toHaveBeenCalledWith(pendingRequest.publicId);
    expect(publishFriendRequests).toHaveBeenCalledWith(
      { incoming: [], outgoing: [] },
      expect.any(Number),
    );
  });

  it("applies poller snapshots while the Friends tab is already open", async () => {
    const element = await mount();
    const arriving = {
      publicId: "new-friend",
      username: null,
      createdAt: "2026-10-02T13:00:00.000Z",
    };

    document.dispatchEvent(
      new CustomEvent("friend-requests-updated", {
        detail: {
          incoming: [arriving],
          outgoing: [],
          seq: nextFriendRequestsSeq(),
        },
      }),
    );
    await element.updateComplete;

    expect(element.textContent).toContain("new-friend");
    expect(element.textContent).not.toContain("friend.1234");
  });

  it("keeps a snapshot published while the initial load is still in flight", async () => {
    let resolveLoad!: (value: {
      incoming: (typeof pendingRequest)[];
      outgoing: never[];
    }) => void;
    fetchFriendRequests.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const element = document.createElement("friends-list") as FriendsElement;
    document.body.appendChild(element);
    await settle(element);

    // The nav poller (or an accept in this tab) publishes a newer snapshot
    // before the slower initial fetch resolves. The tab still publishes its
    // response, but every listener, itself included, keeps the newer one, so
    // the resolved request comes back neither on screen nor on the bell.
    document.dispatchEvent(
      new CustomEvent("friend-requests-updated", {
        detail: {
          incoming: [],
          outgoing: [newerRequest],
          seq: nextFriendRequestsSeq(),
        },
      }),
    );
    resolveLoad({ incoming: [pendingRequest], outgoing: [] });
    await settle(element);

    expect(element.textContent).toContain("newer.9999");
    expect(element.textContent).not.toContain("friend.1234");
  });

  it("applies its own fetch over an older fetch's snapshot that arrives first", async () => {
    // A nav poll started before this tab's fetch, so its snapshot is older,
    // but its response lands first and still lists a request the tab's own
    // fetch knows is resolved. Fetch-start order decides, not arrival order.
    const olderPoll = nextFriendRequestsSeq();
    let resolveLoad!: (value: {
      incoming: never[];
      outgoing: (typeof newerRequest)[];
    }) => void;
    fetchFriendRequests.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const element = document.createElement("friends-list") as FriendsElement;
    document.body.appendChild(element);
    await settle(element);

    document.dispatchEvent(
      new CustomEvent("friend-requests-updated", {
        detail: { incoming: [pendingRequest], outgoing: [], seq: olderPoll },
      }),
    );
    resolveLoad({ incoming: [], outgoing: [newerRequest] });
    await settle(element);

    expect(publishFriendRequests).toHaveBeenCalledWith(
      { incoming: [], outgoing: [newerRequest] },
      expect.any(Number),
    );
    expect(element.textContent).toContain("newer.9999");
    expect(element.textContent).not.toContain("friend.1234");
  });

  it("reloads instead of publishing a snapshot that resolves after the account changed", async () => {
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
      .mockResolvedValueOnce({ incoming: [otherAccountRequest], outgoing: [] });
    const element = document.createElement("friends-list") as FriendsElement;
    document.body.appendChild(element);
    await settle(element);
    expect(fetchFriendRequests).toHaveBeenCalledTimes(1);

    switchAccount();
    resolveFirst({ incoming: [pendingRequest], outgoing: [] });
    await settle(element);

    // The first account's list never reaches the bell; the second fetch,
    // made for the account signed in now, is what gets applied and published.
    expect(fetchFriendRequests).toHaveBeenCalledTimes(2);
    expect(publishFriendRequests).toHaveBeenCalledTimes(1);
    expect(publishFriendRequests).toHaveBeenCalledWith(
      { incoming: [otherAccountRequest], outgoing: [] },
      expect.any(Number),
    );
    expect(element.textContent).toContain("other.5678");
    expect(element.textContent).not.toContain("friend.1234");
  });

  it("reloads instead of publishing a local update when the account changes during accept", async () => {
    let resolveAccept!: (value: true) => void;
    acceptFriendRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAccept = resolve;
      }),
    );
    const element = await mount();
    publishFriendRequests.mockClear();
    fetchFriendRequests.mockClear();
    fetchFriendRequests.mockResolvedValue({
      incoming: [],
      outgoing: [otherAccountRequest],
    });

    button(element, "friends.accept").click();
    switchAccount();
    resolveAccept(true);
    await settle(element);

    expect(fetchFriendRequests).toHaveBeenCalledTimes(1);
    expect(publishFriendRequests).toHaveBeenCalledTimes(1);
    expect(publishFriendRequests).toHaveBeenCalledWith(
      { incoming: [], outgoing: [otherAccountRequest] },
      expect.any(Number),
    );
    expect(publishFriendRequests).not.toHaveBeenCalledWith(
      { incoming: [], outgoing: [] },
      expect.any(Number),
    );
  });
});
