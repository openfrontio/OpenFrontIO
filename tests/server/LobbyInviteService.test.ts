import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyInviteService } from "../../src/server/LobbyInviteService";

describe("LobbyInviteService", () => {
  let service: LobbyInviteService;

  beforeEach(() => {
    service = new LobbyInviteService();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates an invite with a 30-second TTL by default", () => {
    const now = 1000000;
    vi.setSystemTime(now);

    const invite = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      senderUsername: "SenderBob",
      lobbyId: "lobby123",
      gameMode: "ffa",
      map: "Europe",
    });

    expect(invite.id).toBeDefined();
    expect(invite.targetPublicId).toBe("user.target");
    expect(invite.senderPublicId).toBe("user.sender");
    expect(invite.senderUsername).toBe("SenderBob");
    expect(invite.lobbyId).toBe("lobby123");
    expect(invite.createdAt).toBe(now);
    expect(invite.expiresAt).toBe(now + 30000);

    const invites = service.getInvitesForUser("user.target");
    expect(invites).toHaveLength(1);
    expect(invites[0].id).toBe(invite.id);
  });

  it("expires invites after 30 seconds", () => {
    const now = 1000000;
    vi.setSystemTime(now);

    service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      senderUsername: "SenderBob",
      lobbyId: "lobby123",
    });

    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Fast-forward 29 seconds: still valid
    vi.setSystemTime(now + 29000);
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Fast-forward to 31 seconds: expired and pruned
    vi.setSystemTime(now + 31000);
    expect(service.getInvitesForUser("user.target")).toHaveLength(0);
  });

  it("updates existing invite when same sender invites same target to same lobby", () => {
    const now = 1000000;
    vi.setSystemTime(now);

    const first = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      senderUsername: "OldName",
      lobbyId: "lobby123",
    });

    vi.setSystemTime(now + 10000);
    const second = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      senderUsername: "NewName",
      lobbyId: "lobby123",
    });

    expect(second.id).toBe(first.id);
    expect(second.senderUsername).toBe("NewName");
    expect(second.expiresAt).toBe(now + 10000 + 30000);
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);
  });

  it("dismisses an invite for the target user", () => {
    const invite = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      lobbyId: "lobby123",
    });

    // Another user cannot dismiss someone else's invite
    const wrongDismiss = service.dismissInvite("wrong.user", invite.id);
    expect(wrongDismiss).toBe(false);
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Target user dismisses
    const rightDismiss = service.dismissInvite("user.target", invite.id);
    expect(rightDismiss).toBe(true);
    expect(service.getInvitesForUser("user.target")).toHaveLength(0);
  });

  it("filters out invites if lobby is no longer active", () => {
    service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      lobbyId: "lobby_closed",
    });

    service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender2",
      lobbyId: "lobby_active",
    });

    const isLobbyActive = (id: string) => id === "lobby_active";
    const invites = service.getInvitesForUser("user.target", isLobbyActive);
    expect(invites).toHaveLength(1);
    expect(invites[0].lobbyId).toBe("lobby_active");
  });
});
