import type { LobbyInvite } from "@openfront/shared/LobbyInviteSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyInviteService } from "../../src/server/LobbyInviteService";

describe("LobbyInviteService", () => {
  let service: LobbyInviteService;
  let onInviteAdded: ReturnType<typeof vi.fn<(invite: LobbyInvite) => void>>;
  let onInviteDismissed: ReturnType<
    typeof vi.fn<(inviteId: string, dismissedAt: number) => void>
  >;

  beforeEach(() => {
    service = new LobbyInviteService();
    onInviteAdded = vi.fn<(invite: LobbyInvite) => void>();
    onInviteDismissed =
      vi.fn<(inviteId: string, dismissedAt: number) => void>();
    service.setBroadcasters(onInviteAdded, onInviteDismissed);
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
    expect(onInviteAdded).toHaveBeenCalledTimes(1);
    expect(onInviteAdded).toHaveBeenCalledWith(invite);

    const invites = service.getInvitesForUser("user.target");
    expect(invites).toHaveLength(1);
    expect(invites[0].id).toBe(invite.id);
  });

  it("expires invites after 30 seconds", () => {
    const now = 1000000;
    vi.setSystemTime(now);

    const created = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      senderUsername: "SenderBob",
      lobbyId: "lobby123",
    });

    expect(onInviteAdded).toHaveBeenCalledWith(created);
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
    expect(onInviteAdded).toHaveBeenCalledTimes(1);
    expect(onInviteAdded).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: first.id,
        senderUsername: "OldName",
        createdAt: now,
        expiresAt: now + 30000,
      }),
    );

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
    expect(onInviteAdded).toHaveBeenCalledTimes(2);
    expect(onInviteAdded).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: first.id,
        senderUsername: "NewName",
        createdAt: now + 10000,
        expiresAt: now + 10000 + 30000,
      }),
    );
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);
  });

  it("dismisses an invite for the target user", () => {
    const now = 1000000;
    vi.setSystemTime(now);

    const invite = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      lobbyId: "lobby123",
    });

    // Another user cannot dismiss someone else's invite
    const wrongDismiss = service.dismissInvite("wrong.user", invite.id);
    expect(wrongDismiss).toBe(false);
    expect(onInviteDismissed).not.toHaveBeenCalled();
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Target user dismisses
    const rightDismiss = service.dismissInvite("user.target", invite.id);
    expect(rightDismiss).toBe(true);
    expect(onInviteDismissed).toHaveBeenCalledWith(invite.id, now);
    expect(service.getInvitesForUser("user.target")).toHaveLength(0);
  });

  it("rejects stale external invite refreshes older than a dismissal while allowing genuinely newer invites", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    service.dismissExternalInvite("inv_1", now + 5000);

    // Stale refresh created before or at dismissal time is rejected
    const staleAdded = service.addExternalInvite({
      id: "inv_1",
      lobbyId: "lobby123",
      senderPublicId: "user.sender",
      senderUsername: "Sender",
      targetPublicId: "user.target",
      createdAt: now + 4000,
      expiresAt: now + 34000,
    });
    expect(staleAdded).toBe(false);
    expect(service.getInvitesForUser("user.target")).toHaveLength(0);

    // Genuinely newer refresh created after dismissal is accepted
    const freshAdded = service.addExternalInvite({
      id: "inv_1",
      lobbyId: "lobby123",
      senderPublicId: "user.sender",
      senderUsername: "Sender",
      targetPublicId: "user.target",
      createdAt: now + 6000,
      expiresAt: now + 36000,
    });
    expect(freshAdded).toBe(true);
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);
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
