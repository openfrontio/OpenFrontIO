import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  lastUserMeResponse: vi.fn(),
  fetchFriends: vi.fn(),
  fetchClanMembers: vi.fn(),
  fetchLobbyMemberPublicIds: vi.fn(),
  sendLobbyInvite: vi.fn(),
  isAvailable: vi.fn(() => false),
  openInviteDialog: vi.fn(async () => true),
}));

vi.mock("../../src/client/Api", () => ({
  getUserMe: apiMocks.getUserMe,
}));

vi.mock("../../src/client/UserMeBroadcast", () => ({
  lastUserMeResponse: apiMocks.lastUserMeResponse,
}));

vi.mock("../../src/client/FriendsApi", () => ({
  fetchFriends: apiMocks.fetchFriends,
}));

vi.mock("../../src/client/ClanApi", () => ({
  fetchClanMembers: apiMocks.fetchClanMembers,
}));

vi.mock("../../src/client/LobbyInviteApi", () => ({
  fetchLobbyMemberPublicIds: apiMocks.fetchLobbyMemberPublicIds,
  sendLobbyInvite: apiMocks.sendLobbyInvite,
}));

vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: apiMocks.isAvailable,
    openInviteDialog: apiMocks.openInviteDialog,
  },
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      "invite_modal.title": "Invite Friends",
      "invite_modal.friends": "Friends",
      "invite_modal.in_lobby": "In Lobby",
      "invite_modal.invite": "Invite",
      "invite_modal.invited": "Invited",
      "invite_modal.invite_failed": "Could not send invite. Please try again.",
      "invite_modal.empty": "No friends or clan members found",
      "invite_modal.search_placeholder": "Search friends and clan members...",
      "invite_modal.steam_invite": "Invite via Steam",
    };
    if (key === "invite_modal.clan_group") {
      return `Clan [${params?.tag}] (${params?.count})`;
    }
    return map[key] ?? key;
  },
}));

import type { OModal } from "../../src/client/components/baseComponents/Modal";
import { InviteLobbyModal } from "../../src/client/components/InviteLobbyModal";

describe("InviteLobbyModal", () => {
  let modal: InviteLobbyModal;

  beforeEach(() => {
    apiMocks.getUserMe.mockReset();
    apiMocks.lastUserMeResponse.mockReset().mockReturnValue({
      response: {
        player: {
          publicId: "me_pub",
          username: "HostUser",
          clans: [{ tag: "DEV", name: "Developers" }],
        },
      },
    });
    apiMocks.fetchFriends.mockReset().mockResolvedValue({
      results: [
        { publicId: "friend_1", username: "Alice", createdAt: "2026-01-01" },
        { publicId: "friend_2", username: "Bob", createdAt: "2026-01-01" },
      ],
      total: 2,
      page: 1,
    });
    apiMocks.fetchClanMembers.mockReset().mockResolvedValue({
      results: [{ publicId: "clan_1", username: "Charlie", role: "member" }],
      total: 1,
      page: 1,
    });
    apiMocks.fetchLobbyMemberPublicIds.mockReset().mockResolvedValue([]);
    apiMocks.sendLobbyInvite.mockReset().mockResolvedValue(true);
    apiMocks.isAvailable.mockReset().mockReturnValue(false);

    modal = new InviteLobbyModal();
    document.body.appendChild(modal);
  });

  afterEach(() => {
    modal.remove();
    vi.restoreAllMocks();
  });

  it("opens <o-modal> with header slot and body content without native title tooltip", async () => {
    modal.open({
      lobbyId: "aGngnfp4eJ",
      gameMode: "Free For All",
      map: "World",
      clients: [{ clientID: "c1", username: "Bob", clanTag: null }],
    });

    await modal.updateComplete;
    // Allow async loadRoster() to resolve and re-render
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;

    const oModal = modal.querySelector<OModal>("o-modal");
    expect(oModal).not.toBeNull();
    expect(oModal?.isModalOpen).toBe(true);
    expect(oModal?.maxWidth).toBe("480px");
    expect(oModal?.getAttribute("title")).toBe("");

    // Header slot is rendered
    const headerSlot = modal.querySelector('[slot="header"]');
    expect(headerSlot).not.toBeNull();

    // API limits stay within server bounds (20 for friends, 50 for clan members)
    expect(apiMocks.fetchFriends).toHaveBeenCalledWith(1, 20);
    expect(apiMocks.fetchClanMembers).toHaveBeenCalledWith("DEV", 1, 50);

    // Friends and clan members are rendered in the body
    const text = modal.textContent ?? "";
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("Charlie");
    expect(text).toContain("Clan [DEV]");
  });

  it("sends lobby invite and transitions button state when clicked", async () => {
    modal.open({
      lobbyId: "aGngnfp4eJ",
      gameMode: "Free For All",
      map: "World",
      clients: [],
    });

    await modal.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;

    const aliceRow = () =>
      Array.from(
        modal.querySelectorAll("div.flex.items-center.justify-between"),
      ).find((el) => el.textContent?.includes("Alice"));
    const inviteAliceBtn = aliceRow()?.querySelector("button");
    expect(inviteAliceBtn).toBeDefined();

    inviteAliceBtn?.click();
    inviteAliceBtn?.click();
    await modal.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;

    expect(apiMocks.sendLobbyInvite).toHaveBeenCalledTimes(1);
    expect(apiMocks.sendLobbyInvite).toHaveBeenCalledWith({
      targetPublicId: "friend_1",
      lobbyId: "aGngnfp4eJ",
      senderPublicId: "me_pub",
      senderUsername: "HostUser",
      gameMode: "Free For All",
      map: "World",
    });
    expect(aliceRow()?.textContent).toContain("Invited");
    expect(aliceRow()?.querySelector("button")).toBeNull();
  });

  it("keys invite cooldown by lobbyId and targetPublicId, restores button on failure, and updates roster via updateClients", async () => {
    apiMocks.fetchLobbyMemberPublicIds.mockResolvedValueOnce(["friend_2"]);
    modal.open({
      lobbyId: "lobby_one",
      gameMode: "Free For All",
      map: "World",
      clients: [
        // Real ClientInfo entries lack publicId; server-validated memberPublicIds identifies Bob
        { clientID: "c1", username: "Bob", clanTag: null },
        // Another player using Alice's display name without Alice's publicId does not mark Alice In Lobby
        { clientID: "c_impersonator", username: "Alice", clanTag: null },
      ],
    });
    await modal.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;

    const findRow = (name: string) =>
      Array.from(
        modal.querySelectorAll("div.flex.items-center.justify-between"),
      ).find((el) => el.textContent?.includes(name));

    // Bob is initially In Lobby; Alice is not (username alone does not match)
    expect(findRow("Bob")?.textContent).toContain("In Lobby");
    expect(findRow("Alice")?.querySelector("button")).not.toBeNull();

    // Update clients: Bob leaves, Charlie joins (using server-validated memberPublicIds)
    apiMocks.fetchLobbyMemberPublicIds.mockResolvedValueOnce(["clan_1"]);
    modal.updateClients([
      { clientID: "c2", username: "Charlie", clanTag: "DEV" },
    ]);
    await modal.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
    expect(findRow("Bob")?.querySelector("button")).not.toBeNull();
    expect(findRow("Charlie")?.textContent).toContain("In Lobby");

    // Failed invite shows error message and restores button
    apiMocks.sendLobbyInvite.mockResolvedValueOnce(false);
    let shownError = false;
    const onMsg = () => {
      shownError = true;
    };
    window.addEventListener("show-message", onMsg);
    findRow("Alice")?.querySelector("button")?.click();
    await modal.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
    window.removeEventListener("show-message", onMsg);

    expect(shownError).toBe(true);
    expect(findRow("Alice")?.querySelector("button")).not.toBeNull();

    // Successful invite in lobby_one marks Alice Invited in lobby_one, but not in lobby_two, and expires after 30s
    vi.useFakeTimers();
    try {
      apiMocks.sendLobbyInvite.mockResolvedValueOnce(true);
      findRow("Alice")?.querySelector("button")?.click();
      await vi.advanceTimersByTimeAsync(0);
      await modal.updateComplete;
      expect(findRow("Alice")?.textContent).toContain("Invited");

      modal.open({
        lobbyId: "lobby_two",
        gameMode: "Free For All",
        map: "World",
        clients: [],
      });
      await vi.advanceTimersByTimeAsync(0);
      await modal.updateComplete;
      expect(findRow("Alice")?.querySelector("button")).toBeTruthy();

      // Reopen lobby_one before cooldown expires: Alice is still Invited with no button
      modal.open({
        lobbyId: "lobby_one",
        gameMode: "Free For All",
        map: "World",
        clients: [],
      });
      await vi.advanceTimersByTimeAsync(0);
      await modal.updateComplete;
      expect(findRow("Alice")?.textContent).toContain("Invited");
      expect(findRow("Alice")?.querySelector("button")).toBeNull();

      // Advance past the 30-second cooldown in lobby_one: Alice can be invited again
      await vi.advanceTimersByTimeAsync(30_001);
      await modal.updateComplete;
      expect(findRow("Alice")?.querySelector("button")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("paginates clan members beyond page 1 and friends beyond 100", async () => {
    apiMocks.fetchFriends.mockImplementation(
      async (page: number, limit: number) => {
        const total = 110;
        const start = (page - 1) * limit;
        const count = Math.max(0, Math.min(limit, total - start));
        return {
          results: Array.from({ length: count }, (_, i) => ({
            publicId: `friend_${start + i + 1}`,
            username: `Friend${start + i + 1}`,
            createdAt: "2026-01-01",
          })),
          total,
          page,
        };
      },
    );
    apiMocks.fetchClanMembers.mockImplementation(
      async (_tag: string, page: number, limit: number) => {
        const total = 65;
        const start = (page - 1) * limit;
        const count = Math.max(0, Math.min(limit, total - start));
        return {
          results: Array.from({ length: count }, (_, i) => ({
            publicId: `clan_${start + i + 1}`,
            username: `ClanMember${start + i + 1}`,
            role: "member",
          })),
          total,
          page,
        };
      },
    );

    modal.open({
      lobbyId: "lobby_paged",
      gameMode: "Free For All",
      map: "World",
      clients: [],
    });
    await modal.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;

    expect(apiMocks.fetchFriends).toHaveBeenCalledTimes(6);
    expect(apiMocks.fetchClanMembers).toHaveBeenCalledTimes(2);
    const text = modal.textContent ?? "";
    expect(text).toContain("Friend110");
    expect(text).toContain("ClanMember65");
  });

  it("tracks in-flight roster refresh ownership and recovers when stalled", async () => {
    const modal = document.createElement(
      "invite-lobby-modal",
    ) as InviteLobbyModal;
    document.body.appendChild(modal);

    modal.open({
      lobbyId: "lobby_stalled",
      clients: [{ clientID: "c1", username: "Alice", clanTag: null }],
    });
    await modal.updateComplete;

    let firstSignal: AbortSignal | undefined;
    let resolveFirst!: (value: string[] | false) => void;
    apiMocks.fetchLobbyMemberPublicIds.mockImplementationOnce((_id, signal) => {
      firstSignal = signal;
      return new Promise<string[] | false>((resolve) => {
        resolveFirst = resolve;
      });
    });

    const initialCalls = apiMocks.fetchLobbyMemberPublicIds.mock.calls.length;
    modal.updateClients([{ clientID: "c1", username: "Alice", clanTag: null }]);
    expect(apiMocks.fetchLobbyMemberPublicIds).toHaveBeenCalledTimes(
      initialCalls + 1,
    );

    // Repeated call with same roster before timeout is skipped
    modal.updateClients([{ clientID: "c1", username: "Alice", clanTag: null }]);
    expect(apiMocks.fetchLobbyMemberPublicIds).toHaveBeenCalledTimes(
      initialCalls + 1,
    );

    // Advance past stall threshold to allow retry
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(5001);
      let resolveSecond!: (value: string[] | false) => void;
      apiMocks.fetchLobbyMemberPublicIds.mockReturnValueOnce(
        new Promise<string[] | false>((resolve) => {
          resolveSecond = resolve;
        }),
      );

      modal.updateClients([
        { clientID: "c1", username: "Alice", clanTag: null },
      ]);
      expect(apiMocks.fetchLobbyMemberPublicIds).toHaveBeenCalledTimes(
        initialCalls + 2,
      );
      expect(firstSignal?.aborted).toBe(true);

      resolveFirst(false);
      await Promise.resolve();

      // Updating again while replacement is in flight does not trigger another request
      modal.updateClients([
        { clientID: "c1", username: "Alice", clanTag: null },
      ]);
      expect(apiMocks.fetchLobbyMemberPublicIds).toHaveBeenCalledTimes(
        initialCalls + 2,
      );
      expect(firstSignal?.aborted).toBe(true);

      resolveSecond(["f1"]);
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});
