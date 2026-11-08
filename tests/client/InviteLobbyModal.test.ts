import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  lastUserMeResponse: vi.fn(),
  fetchFriends: vi.fn(),
  fetchClanMembers: vi.fn(),
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
  sendLobbyInvite: apiMocks.sendLobbyInvite,
}));

vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: apiMocks.isAvailable,
    openInviteDialog: apiMocks.openInviteDialog,
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

    const buttons = Array.from(modal.querySelectorAll("button"));
    const inviteAliceBtn = buttons.find((b) =>
      b
        .closest("div.flex.items-center.justify-between")
        ?.textContent?.includes("Alice"),
    );
    expect(inviteAliceBtn).toBeDefined();

    inviteAliceBtn?.click();
    await modal.updateComplete;

    expect(apiMocks.sendLobbyInvite).toHaveBeenCalledWith({
      targetPublicId: "friend_1",
      lobbyId: "aGngnfp4eJ",
      senderPublicId: "me_pub",
      senderUsername: "HostUser",
      gameMode: "Free For All",
      map: "World",
    });
  });
});
