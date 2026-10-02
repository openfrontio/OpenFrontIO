import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  acceptFriendRequest,
  deleteFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  publishFriendRequests,
} = vi.hoisted(() => ({
  acceptFriendRequest: vi.fn(async () => true as const),
  deleteFriendRequest: vi.fn(async () => true as const),
  fetchFriendRequests: vi.fn(),
  fetchFriends: vi.fn(),
  publishFriendRequests: vi.fn(),
}));

vi.mock("../../../src/client/FriendsApi", () => ({
  acceptFriendRequest,
  deleteFriendRequest,
  fetchFriendRequests,
  fetchFriends,
  FRIEND_REQUESTS_UPDATED_EVENT: "friend-requests-updated",
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
    expect(publishFriendRequests).toHaveBeenCalledWith({
      incoming: [pendingRequest],
      outgoing: [],
    });
    publishFriendRequests.mockClear();

    button(element, "friends.accept").click();
    await settle(element);

    expect(acceptFriendRequest).toHaveBeenCalledWith(pendingRequest.publicId);
    expect(publishFriendRequests).toHaveBeenCalledWith({
      incoming: [],
      outgoing: [],
    });
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
        detail: { incoming: [arriving], outgoing: [] },
      }),
    );
    await element.updateComplete;

    expect(element.textContent).toContain("new-friend");
    expect(element.textContent).not.toContain("friend.1234");
  });
});
