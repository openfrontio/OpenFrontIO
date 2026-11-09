import type { LobbyInvite } from "@openfront/shared/LobbyInviteSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyClientToken } from "../../src/server/jwt";
import {
  LobbyInviteService,
  registerLobbyInviteRoutes,
} from "../../src/server/LobbyInviteService";
import { ServerEnv } from "../../src/server/ServerEnv";

vi.mock("../../src/server/jwt", () => ({
  verifyClientToken: vi.fn(),
  getUserMe: vi.fn(),
}));

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
    })!;

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
    })!;

    expect(onInviteAdded).toHaveBeenCalledWith(created);
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Fast-forward 29 seconds: still valid
    vi.setSystemTime(now + 29000);
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Fast-forward to 31 seconds: expired and pruned
    vi.setSystemTime(now + 31000);
    expect(service.getInvitesForUser("user.target")).toHaveLength(0);
  });

  it("no-ops repeat invite while live and enforces cooldown after dismissal", () => {
    const now = 1000000;
    vi.setSystemTime(now);

    const first = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      senderUsername: "OldName",
      lobbyId: "lobby123",
    });
    expect(first).not.toBeNull();
    expect(onInviteAdded).toHaveBeenCalledTimes(1);

    // Calling invite again while live is a no-op: does not bump timestamps and does not re-broadcast over IPC
    vi.setSystemTime(now + 10000);
    const second = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      senderUsername: "NewName",
      lobbyId: "lobby123",
    });

    expect(second?.id).toBe(first!.id);
    expect(second?.createdAt).toBe(now);
    expect(second?.expiresAt).toBe(now + 30000);
    expect(onInviteAdded).toHaveBeenCalledTimes(1);

    // Target dismisses the invite
    const dismissed = service.dismissInvite("user.target", first!.id);
    expect(dismissed).toBe(true);

    // Sender cannot spam invite to bypass dismissal while TTL is active
    vi.setSystemTime(now + 15000);
    const rejected = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      lobbyId: "lobby123",
    });
    expect(rejected).toBeNull();
    expect(onInviteAdded).toHaveBeenCalledTimes(1);

    // After 30s TTL from dismissal passes, new invite can be created
    vi.setSystemTime(now + 45000);
    const newInvite = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      lobbyId: "lobby123",
    });
    expect(newInvite).not.toBeNull();
    expect(onInviteAdded).toHaveBeenCalledTimes(2);
  });

  it("dismisses an invite for the target user", () => {
    const now = 1000000;
    vi.setSystemTime(now);

    const invite = service.createInvite({
      targetPublicId: "user.target",
      senderPublicId: "user.sender",
      lobbyId: "lobby123",
    })!;

    // Another user cannot dismiss someone else's invite
    const wrongDismiss = service.dismissInvite("wrong.user", invite.id);
    expect(wrongDismiss).toBe(false);
    expect(onInviteDismissed).not.toHaveBeenCalled();
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Unknown invite ID returns false without dismissing anything
    expect(service.dismissInvite("user.target", "nonexistent_id")).toBe(false);

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

    const exactDismissalAdded = service.addExternalInvite({
      id: "inv_1",
      lobbyId: "lobby123",
      senderPublicId: "user.sender",
      senderUsername: "Sender",
      targetPublicId: "user.target",
      createdAt: now + 5000,
      expiresAt: now + 35000,
    });
    expect(exactDismissalAdded).toBe(false);
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

  it("converges concurrent creates for the same logical invite across processes", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const serviceA = new LobbyInviteService();
    const serviceB = new LobbyInviteService();

    const invA: LobbyInvite = {
      id: "inv_a",
      lobbyId: "lobby123",
      senderPublicId: "user.sender",
      senderUsername: "Sender",
      targetPublicId: "user.target",
      createdAt: now,
      expiresAt: now + 30000,
    };
    const invB: LobbyInvite = {
      id: "inv_b",
      lobbyId: "lobby123",
      senderPublicId: "user.sender",
      senderUsername: "Sender",
      targetPublicId: "user.target",
      createdAt: now + 100,
      expiresAt: now + 30100,
    };

    // Process A receives inv_a then inv_b; Process B receives inv_b then inv_a
    serviceA.addExternalInvite(invA);
    serviceA.addExternalInvite(invB);
    serviceB.addExternalInvite(invB);
    serviceB.addExternalInvite(invA);

    const activeA = serviceA.getInvitesForUser("user.target");
    const activeB = serviceB.getInvitesForUser("user.target");
    expect(activeA).toHaveLength(1);
    expect(activeB).toHaveLength(1);
    expect(activeA[0].id).toBe("inv_b");
    expect(activeB[0].id).toBe("inv_b");

    // Dismissing even by the superseded id clears the logical invite on both processes
    expect(serviceA.dismissInvite("user.target", "inv_a")).toBe(true);
    expect(serviceB.dismissInvite("user.target", "inv_a")).toBe(true);
    expect(serviceA.getInvitesForUser("user.target")).toHaveLength(0);
    expect(serviceB.getInvitesForUser("user.target")).toHaveLength(0);

    // Relay test: master knows inv_a and inv_b, recipient replica knows only inv_b.
    // Dismissing inv_a at or after inv_b.createdAt on master resolves to inv_b and broadcasts inv_b,
    // so recipient replica clears inv_b upon receiving the broadcast.
    const masterService = new LobbyInviteService();
    const recipientReplica = new LobbyInviteService();
    const broadcasts: { id: string; dismissedAt: number }[] = [];
    masterService.setBroadcasters(
      () => {},
      (id, ts) => {
        broadcasts.push({ id, dismissedAt: ts });
      },
    );

    // Fast forward slightly so dismissal timestamp > invB.createdAt
    vi.setSystemTime(now + 200);

    masterService.addExternalInvite(invA);
    masterService.addExternalInvite(invB);
    recipientReplica.addExternalInvite(invB);
    expect(recipientReplica.getInvitesForUser("user.target")).toHaveLength(1);

    const dismissedOnMaster = masterService.dismissInvite(
      "user.target",
      "inv_a",
    );
    expect(dismissedOnMaster).toBe(true);
    expect(broadcasts.some((b) => b.id === "inv_b")).toBe(true);
    for (const b of broadcasts) {
      recipientReplica.dismissExternalInvite(b.id, b.dismissedAt);
    }
    expect(recipientReplica.getInvitesForUser("user.target")).toHaveLength(0);

    // Equal timestamps tie-break deterministically by lexicographic invite id regardless of arrival order
    const invTie1: LobbyInvite = {
      id: "inv_tie_1",
      lobbyId: "lobby_tie",
      senderPublicId: "user.sender",
      senderUsername: "Sender",
      targetPublicId: "user.target",
      createdAt: now + 200,
      expiresAt: now + 30200,
    };
    const invTie2: LobbyInvite = {
      id: "inv_tie_2",
      lobbyId: "lobby_tie",
      senderPublicId: "user.sender",
      senderUsername: "Sender",
      targetPublicId: "user.target",
      createdAt: now + 200,
      expiresAt: now + 30200,
    };

    serviceA.addExternalInvite(invTie1);
    serviceA.addExternalInvite(invTie2);
    serviceB.addExternalInvite(invTie2);
    serviceB.addExternalInvite(invTie1);

    expect(serviceA.getInvitesForUser("user.target")[0]?.id).toBe("inv_tie_2");
    expect(serviceB.getInvitesForUser("user.target")[0]?.id).toBe("inv_tie_2");
  });

  it("retains target-scoped dismissal arriving before the invite and verifies ownership on arrival", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    // Non-owner dismissal arriving before the invite is retained as pending and does not suppress it for the real target
    expect(
      service.dismissExternalInvite("inv_early", now + 1000, "wrong.user"),
    ).toBe("inv_early");
    expect(
      service.addExternalInvite({
        id: "inv_early",
        lobbyId: "lobby123",
        senderPublicId: "user.sender",
        senderUsername: "Sender",
        targetPublicId: "user.target",
        createdAt: now,
        expiresAt: now + 30000,
      }),
    ).toBe(true);
    expect(service.getInvitesForUser("user.target")).toHaveLength(1);

    // Legitimate target dismissal arriving before the invite suppresses it on arrival
    expect(
      service.dismissExternalInvite(
        "inv_early_legit",
        now + 1000,
        "user.target",
      ),
    ).toBe("inv_early_legit");
    expect(
      service.addExternalInvite({
        id: "inv_early_legit",
        lobbyId: "lobby456",
        senderPublicId: "user.sender",
        senderUsername: "Sender",
        targetPublicId: "user.target",
        createdAt: now,
        expiresAt: now + 30000,
      }),
    ).toBe(false);
    expect(
      service
        .getInvitesForUser("user.target")
        .some((inv) => inv.id === "inv_early_legit"),
    ).toBe(false);
  });

  it("allows inviting a clan member who is not a friend and enforces lobby allowlist and authoritative settings", async () => {
    vi.useRealTimers();
    LobbyInviteService.instance.reset();

    vi.mocked(verifyClientToken).mockResolvedValue({
      type: "success",
      persistentId: "sender-persistent-id",
      claims: {} as any,
    });

    vi.spyOn(ServerEnv, "jwtIssuer").mockReturnValue("https://api.example.com");
    vi.spyOn(ServerEnv, "apiKey").mockReturnValue("test-api-key");

    let onEligibilityCheck: (() => void) | undefined;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        onEligibilityCheck?.();
        return new Response(
          JSON.stringify({
            results: [{ publicId: "clan.mate" }],
            total: 1,
            page: 1,
            limit: 50,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

    const postHandlers = new Map<
      string,
      (req: any, res: any) => Promise<any>
    >();
    const mockApp = {
      post(path: string, handler: (req: any, res: any) => Promise<any>) {
        postHandlers.set(path, handler);
      },
      get() {},
    };
    let allowedPublicIds: string[] | undefined = ["clan.mate"];
    let customAllowedOverride: boolean | undefined;
    registerLobbyInviteRoutes(mockApp as any, {
      isLobbyActive: () => true,
      isPlayerInLobby: () => true,
      getLobbyMeta: () => ({
        gameMode: "Team",
        map: "Europe",
        allowedPublicIds,
      }),
      isTargetAllowedInLobby: (_lobbyId, targetPublicId) => {
        if (customAllowedOverride !== undefined) {
          return customAllowedOverride;
        }
        return (
          !allowedPublicIds ||
          allowedPublicIds.length === 0 ||
          allowedPublicIds.includes(targetPublicId)
        );
      },
      resolveCaller: async () => ({
        publicId: "caller.pub",
        username: "CallerName",
        friends: [],
        clanTags: ["DEV"],
      }),
    });

    const inviteHandler = postHandlers.get("/api/lobby/invite")!;
    const callInvite = async (body: Record<string, unknown>) => {
      const res: any = {
        statusCode: 200,
        body: undefined,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: unknown) {
          this.body = data;
          return this;
        },
      };
      await inviteHandler(
        {
          headers: { authorization: "Bearer valid-token" },
          body,
        },
        res,
      );
      return res;
    };

    try {
      // 1. Target is in clan DEV (not a friend) and on the lobby allowlist -> succeeds with authoritative gameMode/map
      const okRes = await callInvite({
        targetPublicId: "clan.mate",
        lobbyId: "lobby_clan",
        gameMode: "Free For All",
        map: "World",
      });
      expect(okRes.statusCode).toBe(200);
      expect(okRes.body.ok).toBe(true);
      expect(okRes.body.invite.gameMode).toBe("Team");
      expect(okRes.body.invite.map).toBe("Europe");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/clans/DEV/members?page=1&limit=50"),
        expect.any(Object),
      );

      // 2. Target is blocked by the lobby allowlist -> 403
      allowedPublicIds = ["someone.else"];
      const blockedRes = await callInvite({
        targetPublicId: "clan.mate",
        lobbyId: "lobby_clan",
      });
      expect(blockedRes.statusCode).toBe(403);

      // 3. isTargetAllowedInLobby takes precedence over conflicting getLobbyMeta.allowedPublicIds
      allowedPublicIds = ["someone.else"];
      customAllowedOverride = true;
      const overrideAllowRes = await callInvite({
        targetPublicId: "clan.mate",
        lobbyId: "lobby_clan",
      });
      expect(overrideAllowRes.statusCode).toBe(200);

      allowedPublicIds = ["clan.mate"];
      customAllowedOverride = false;
      const overrideDenyRes = await callInvite({
        targetPublicId: "clan.mate",
        lobbyId: "lobby_clan",
      });
      expect(overrideDenyRes.statusCode).toBe(403);

      // 4. Target removed from allowlist while async eligibility check is in flight -> 403
      customAllowedOverride = undefined;
      allowedPublicIds = ["clan.mate"];
      onEligibilityCheck = () => {
        allowedPublicIds = ["someone.else"];
      };
      const raceDeniedRes = await callInvite({
        targetPublicId: "clan.mate",
        lobbyId: "lobby_clan",
      });
      expect(raceDeniedRes.statusCode).toBe(403);
    } finally {
      fetchSpy.mockRestore();
      LobbyInviteService.instance.reset();
    }
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

  it("rejects invites and member queries for public lobbies and hides strangers' public IDs", async () => {
    LobbyInviteService.instance.reset();
    try {
      vi.mocked(verifyClientToken).mockResolvedValue({
        type: "success",
        persistentId: "pid1",
        token: "valid-token",
      } as any);

      const getHandlers = new Map<
        string,
        (req: any, res: any) => Promise<any>
      >();
      const postHandlers = new Map<
        string,
        (req: any, res: any) => Promise<any>
      >();
      const mockApp = {
        get(path: string, handler: (req: any, res: any) => Promise<any>) {
          getHandlers.set(path, handler);
        },
        post(path: string, handler: (req: any, res: any) => Promise<any>) {
          postHandlers.set(path, handler);
        },
      };

      let isLobbyPublic = false;
      let lobbyGameMode: string | undefined = "Free For All";
      registerLobbyInviteRoutes(mockApp as any, {
        isLobbyActive: () => true,
        isPlayerInLobby: () => true,
        getLobbyMeta: () => ({
          isPublic: isLobbyPublic,
          gameMode: lobbyGameMode,
          memberPublicIds: ["caller.pub", "friend.pub", "stranger.pub"],
        }),
        resolveCaller: async () => ({
          publicId: "caller.pub",
          username: "CallerName",
          friends: ["friend.pub"],
          clanTags: [],
        }),
      });

      const membersHandler = getHandlers.get("/api/lobby/members")!;
      const inviteHandler = postHandlers.get("/api/lobby/invite")!;

      const callMembers = async () => {
        const res: any = {
          statusCode: 200,
          body: undefined,
          status(c: number) {
            this.statusCode = c;
            return this;
          },
          json(d: unknown) {
            this.body = d;
            return this;
          },
        };
        await membersHandler(
          {
            headers: { authorization: "Bearer valid-token" },
            query: { lobbyId: "lob1" },
          },
          res,
        );
        return res;
      };

      const callInvite = async () => {
        const res: any = {
          statusCode: 200,
          body: undefined,
          status(c: number) {
            this.statusCode = c;
            return this;
          },
          json(d: unknown) {
            this.body = d;
            return this;
          },
        };
        await inviteHandler(
          {
            headers: { authorization: "Bearer valid-token" },
            body: { lobbyId: "lob1", targetPublicId: "friend.pub" },
          },
          res,
        );
        return res;
      };

      // Private lobby: members only returns caller and friend, NOT stranger
      const privRes = await callMembers();
      expect(privRes.statusCode).toBe(200);
      expect(privRes.body.memberPublicIds).toEqual([
        "caller.pub",
        "friend.pub",
      ]);
      expect(privRes.body.memberPublicIds).not.toContain("stranger.pub");

      // Private lobby: invite returns 200 ok and stores invite for friend.pub
      const privInviteRes = await callInvite();
      expect(privInviteRes.statusCode).toBe(200);
      expect(privInviteRes.body.ok).toBe(true);
      const stored =
        LobbyInviteService.instance.getInvitesForUser("friend.pub");
      expect(stored).toHaveLength(1);
      expect(stored[0].senderPublicId).toBe("caller.pub");
      expect(stored[0].lobbyId).toBe("lob1");

      // Public FFA lobby: members returns 403
      isLobbyPublic = true;
      lobbyGameMode = "Free For All";
      const pubRes = await callMembers();
      expect(pubRes.statusCode).toBe(403);

      // Public FFA lobby: invite returns 403
      const pubInviteRes = await callInvite();
      expect(pubInviteRes.statusCode).toBe(403);

      // Public Team lobby: members returns 200, invite returns 200
      lobbyGameMode = "Team";
      const pubTeamMembersRes = await callMembers();
      expect(pubTeamMembersRes.statusCode).toBe(200);
      expect(pubTeamMembersRes.body.memberPublicIds).toEqual([
        "caller.pub",
        "friend.pub",
      ]);
      const pubTeamInviteRes = await callInvite();
      expect(pubTeamInviteRes.statusCode).toBe(200);
    } finally {
      LobbyInviteService.instance.reset();
    }
  });

  it("returns 502 from /api/lobby/members when clan lookup fails or receives invalid data", async () => {
    vi.mocked(verifyClientToken).mockResolvedValue({
      type: "success",
      persistentId: "pid1",
      token: "valid-token",
    } as any);

    const getHandlers = new Map<string, (req: any, res: any) => Promise<any>>();
    const mockApp = {
      get(path: string, handler: (req: any, res: any) => Promise<any>) {
        getHandlers.set(path, handler);
      },
      post() {},
    };

    registerLobbyInviteRoutes(mockApp as any, {
      isLobbyActive: () => true,
      isPlayerInLobby: () => true,
      getLobbyMeta: () => ({
        isPublic: false,
        memberPublicIds: ["caller.pub", "clan_candidate.pub"],
      }),
      resolveCaller: async () => ({
        publicId: "caller.pub",
        username: "CallerName",
        friends: [],
        clanTags: ["CLAN_A"],
      }),
    });

    const membersHandler = getHandlers.get("/api/lobby/members")!;
    const callMembers = async () => {
      const res: any = {
        statusCode: 200,
        body: undefined,
        status(c: number) {
          this.statusCode = c;
          return this;
        },
        json(d: unknown) {
          this.body = d;
          return this;
        },
      };
      await membersHandler(
        {
          headers: { authorization: "Bearer valid-token" },
          query: { lobbyId: "lob1" },
        },
        res,
      );
      return res;
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      // 1. HTTP 500 error on clan lookup -> 502
      fetchSpy.mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );
      const failRes = await callMembers();
      expect(failRes.statusCode).toBe(502);

      // 2. HTTP 200 with invalid schema (empty object missing members/results) -> 502
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const invalidRes = await callMembers();
      expect(invalidRes.statusCode).toBe(502);

      // 3. Network fetch rejection -> 502
      fetchSpy.mockRejectedValueOnce(new Error("Network connection dropped"));
      const rejectRes = await callMembers();
      expect(rejectRes.statusCode).toBe(502);

      // 4. Page 1 succeeds with 50 members and total=100, but page 2 fails -> 502
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: Array.from({ length: 50 }, (_, i) => ({
              publicId: `m_${i}`,
            })),
            total: 100,
            page: 1,
            limit: 50,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      fetchSpy.mockResolvedValueOnce(
        new Response("Gateway Timeout", { status: 504 }),
      );
      const partialPageFailRes = await callMembers();
      expect(partialPageFailRes.statusCode).toBe(502);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stops fetching clan roster pages as soon as target is found and returns 502 on upstream pagination failure", async () => {
    vi.mocked(verifyClientToken).mockResolvedValue({
      type: "success",
      persistentId: "pid1",
      token: "valid-token",
    } as any);

    const postHandlers = new Map<
      string,
      (req: any, res: any) => Promise<any>
    >();
    const mockApp = {
      get() {},
      post(path: string, handler: (req: any, res: any) => Promise<any>) {
        postHandlers.set(path, handler);
      },
    };

    registerLobbyInviteRoutes(mockApp as any, {
      isLobbyActive: () => true,
      isPlayerInLobby: () => true,
      getLobbyMeta: () => ({
        isPublic: false,
        memberPublicIds: ["caller.pub"],
      }),
      resolveCaller: async () => ({
        publicId: "caller.pub",
        username: "CallerName",
        friends: [],
        clanTags: ["CLAN_A"],
      }),
    });

    const inviteHandler = postHandlers.get("/api/lobby/invite")!;
    const callInvite = async (targetPublicId: string) => {
      const res: any = {
        statusCode: 200,
        body: undefined,
        status(c: number) {
          this.statusCode = c;
          return this;
        },
        json(d: unknown) {
          this.body = d;
          return this;
        },
      };
      await inviteHandler(
        {
          headers: { authorization: "Bearer valid-token" },
          body: { lobbyId: "lob1", targetPublicId },
        },
        res,
      );
      return res;
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      // 1. Target found on page 1 of multi-page clan: stops immediately without fetching page 2
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              ...Array.from({ length: 49 }, (_, i) => ({
                publicId: `other_member_${i}`,
              })),
              { publicId: "clan_member_1" },
            ],
            total: 100,
            page: 1,
            limit: 50,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      // Stub any unexpected second-page fetch so it would fail if early stop didn't work
      fetchSpy.mockResolvedValueOnce(
        new Response("Unexpected page 2 fetch", { status: 500 }),
      );
      const okRes = await callInvite("clan_member_1");
      expect(okRes.statusCode).toBe(200);
      expect(okRes.body.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockReset();

      // 2. Upstream failure on page 1 before membership is determined -> 502
      fetchSpy.mockResolvedValueOnce(
        new Response("Upstream Error", { status: 500 }),
      );
      const failRes = await callInvite("clan_member_unknown");
      expect(failRes.statusCode).toBe(502);
      expect(failRes.body.error).toBe("Failed to verify clan membership");

      fetchSpy.mockReset();

      // 3. Page 1 succeeds without target, page 2 fails before target is found -> 502
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: Array.from({ length: 50 }, (_, i) => ({
              publicId: `other_${i}`,
            })),
            total: 100,
            page: 1,
            limit: 50,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      fetchSpy.mockResolvedValueOnce(
        new Response("Gateway Timeout", { status: 504 }),
      );
      const partialFailRes = await callInvite("clan_member_unknown");
      expect(partialFailRes.statusCode).toBe(502);
      expect(partialFailRes.body.error).toBe(
        "Failed to verify clan membership",
      );

      fetchSpy.mockReset();

      // 4. All pages complete and target is not in clan -> 403
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ publicId: "other_member" }],
            total: 1,
            page: 1,
            limit: 50,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      const nonmemberRes = await callInvite("nonmember");
      expect(nonmemberRes.statusCode).toBe(403);
      expect(nonmemberRes.body.error).toBe(
        "Target is not an eligible friend or clan member",
      );
    } finally {
      fetchSpy.mockRestore();
      LobbyInviteService.instance.reset();
    }
  });

  it("applies cooldown only on explicit dismissal, allowing re-invite after lobby cleanup", () => {
    LobbyInviteService.instance.reset();
    try {
      const inviteInput = {
        lobbyId: "lob_cleanup",
        senderPublicId: "sender_1",
        targetPublicId: "target_1",
        gameMode: "Team",
        map: "World",
      };

      // 1. Initial invite created successfully
      const inv1 = LobbyInviteService.instance.createInvite(inviteInput);
      expect(inv1).not.toBeNull();

      // 2. Host cancels start / lobby is cleaned up
      LobbyInviteService.instance.removeInvitesForLobby("lob_cleanup");
      expect(
        LobbyInviteService.instance.getInvitesForUser("target_1"),
      ).toHaveLength(0);

      // 3. Creating a new invite for the same lobby/pair succeeds immediately (no cooldown from lobby removal)
      const inv2 = LobbyInviteService.instance.createInvite(inviteInput);
      expect(inv2).not.toBeNull();

      // 4. Target explicitly dismisses the invite
      const dismissed = LobbyInviteService.instance.dismissInvite(
        "target_1",
        inv2!.id,
      );
      expect(dismissed).toBe(true);

      // 5. Creating invite again is now blocked by explicit dismissal cooldown
      const inv3 = LobbyInviteService.instance.createInvite(inviteInput);
      expect(inv3).toBeNull();

      // 6. Remaining cooldown is positive
      const remainingMs =
        LobbyInviteService.instance.getInviteCooldownRemainingMs(inviteInput);
      expect(remainingMs).toBeGreaterThan(0);
      expect(remainingMs).toBeLessThanOrEqual(30_000);
    } finally {
      LobbyInviteService.instance.reset();
    }
  });

  it("returns HTTP 429 with Retry-After and retryAfterSeconds when invite is on cooldown", async () => {
    LobbyInviteService.instance.reset();
    vi.mocked(verifyClientToken).mockResolvedValue({
      type: "success",
      persistentId: "caller_cd",
      claims: {} as any,
    });
    let inviteHandler: any;
    const app: any = {
      post(path: string, handler: any) {
        if (path === "/api/lobby/invite") inviteHandler = handler;
      },
      get() {},
    };

    registerLobbyInviteRoutes(app, {
      resolveCaller: async () => ({
        publicId: "caller_cd",
        username: "CallerCD",
        friends: ["target_cd"],
        clanTags: [],
      }),
      isLobbyActive: () => true,
      isPlayerInLobby: () => true,
      getLobbyMeta: () => ({
        gameMode: "Team",
        map: "World",
        isPublic: false,
      }),
    });

    try {
      const callInvite = async () => {
        const headers: Record<string, string> = {};
        const res: any = {
          statusCode: 200,
          body: undefined,
          setHeader(name: string, val: string) {
            headers[name.toLowerCase()] = val;
            return this;
          },
          status(c: number) {
            this.statusCode = c;
            return this;
          },
          json(d: unknown) {
            this.body = d;
            return this;
          },
          headers,
        };
        await inviteHandler(
          {
            headers: { authorization: "Bearer token" },
            body: { lobbyId: "lob_cd", targetPublicId: "target_cd" },
          },
          res,
        );
        return res;
      };

      // First invite succeeds
      const res1 = await callInvite();
      expect(res1.statusCode).toBe(200);
      expect(res1.body.ok).toBe(true);
      const inviteId = res1.body.invite.id;

      // Target dismisses
      LobbyInviteService.instance.dismissInvite("target_cd", inviteId);

      // Next invite immediately gets 429 with Retry-After header and body
      const res2 = await callInvite();
      expect(res2.statusCode).toBe(429);
      expect(res2.headers["retry-after"]).toBeDefined();
      expect(Number(res2.headers["retry-after"])).toBeGreaterThan(0);
      expect(res2.body.error).toContain("cooldown");
      expect(res2.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(res2.body.retryAfterMs).toBeGreaterThan(0);
    } finally {
      LobbyInviteService.instance.reset();
    }
  });
});
