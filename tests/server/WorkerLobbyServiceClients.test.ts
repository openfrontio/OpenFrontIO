import EventEmitter from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { verifyClientToken } from "../../src/server/jwt";
import { defaultResolveCaller } from "../../src/server/LobbyInviteService";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import { mockLogger } from "../util/GameServerHarness";

vi.mock("../../src/server/jwt", () => ({
  verifyClientToken: vi.fn(),
}));
vi.mock("../../src/server/LobbyInviteService", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    defaultResolveCaller: vi.fn(),
  };
});

// connectedClients() feeds the openfront.lobby_clients.gauge metric: it must
// follow connects, closes, and the dead-socket sweep done at broadcast time.
describe("WorkerLobbyService.connectedClients", () => {
  let service: WorkerLobbyService;

  beforeEach(() => {
    const gm = {
      publicLobbies: vi.fn().mockReturnValue([]),
      listedLobbies: vi.fn().mockReturnValue([]),
      game: vi.fn().mockReturnValue(null),
      activeGames: vi.fn().mockReturnValue(0),
    };
    const server = new EventEmitter();
    service = new WorkerLobbyService(
      server as any,
      { handleUpgrade: vi.fn() } as any,
      gm as any,
      mockLogger(),
    );
    (service as any).sendToMaster = vi.fn();
  });

  function connectClient(url?: string) {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const ws = {
      send: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers.set(event, cb);
      }),
      readyState: WebSocket.OPEN as number,
      close: () => handlers.get("close")?.(),
      terminate: vi.fn(),
      emit: (event: string, ...args: unknown[]) =>
        handlers.get(event)?.(...args),
    };
    (service as any).lobbiesWss.emit(
      "connection",
      ws,
      url === undefined ? undefined : { url },
    );
    return ws;
  }

  it("counts clients per platform from the upgrade URL, zeros included", () => {
    connectClient("/w0/lobbies?platform=steam");
    connectClient("/w0/lobbies?platform=web");
    connectClient("/w0/lobbies?platform=web");
    connectClient("/w0/lobbies?platform=toaster");
    connectClient("/w0/lobbies?platform=viverse");
    connectClient("/w0/lobbies");
    expect(Object.fromEntries(service.connectedClientsByPlatform())).toEqual({
      web: 2,
      steam: 1,
      crazygames: 0,
      poki: 0,
      viverse: 1,
      unknown: 2,
    });
  });

  it("counts connected sockets and drops them on close", () => {
    expect(service.connectedClients()).toBe(0);
    const a = connectClient();
    connectClient();
    expect(service.connectedClients()).toBe(2);
    a.close();
    expect(service.connectedClients()).toBe(1);
  });

  it("drops sockets found dead during a broadcast", () => {
    const ws = connectClient();
    ws.readyState = WebSocket.CLOSED;
    (service as any).handleMasterMessage({
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: 1000,
        games: { ffa: [], team: [], special: [], hosted: [] },
      },
    });
    expect(service.connectedClients()).toBe(0);
  });

  it("pushes lobby invite and dismissal over WebSocket to target player", () => {
    const ws = connectClient("/w0/lobbies?platform=web");
    (service as any).registerAuthenticatedLobbySocket(ws, "target.pub");

    const wsOther = connectClient("/w0/lobbies?platform=web");
    (service as any).registerAuthenticatedLobbySocket(wsOther, "other.pub");

    const wsUnauth = connectClient("/w0/lobbies?platform=web");

    const sampleInvite = {
      id: "inv_ws_1",
      lobbyId: "lob_ws",
      senderPublicId: "sender.pub",
      senderUsername: "Sender",
      targetPublicId: "target.pub",
      gameMode: "Team",
      map: "World",
      createdAt: Date.now(),
      expiresAt: Date.now() + 30_000,
    };

    // Broadcast invite
    (service as any).handleMasterMessage({
      type: "lobbyInviteBroadcast",
      invite: sampleInvite,
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(wsOther.send).not.toHaveBeenCalled();
    expect(wsUnauth.send).not.toHaveBeenCalled();
    const sentData = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sentData).toEqual({
      type: "lobby_invite",
      invite: sampleInvite,
      serverTime: expect.any(Number),
    });

    // Broadcast dismissal
    (service as any).handleMasterMessage({
      type: "lobbyInviteDismissBroadcast",
      inviteId: "inv_ws_1",
      targetPublicId: "target.pub",
    });

    expect(ws.send).toHaveBeenCalledTimes(2);
    expect(wsOther.send).not.toHaveBeenCalled();
    expect(wsUnauth.send).not.toHaveBeenCalled();
    const sentDismiss = JSON.parse(ws.send.mock.calls[1][0]);
    expect(sentDismiss).toEqual({
      type: "lobby_invite_dismiss",
      inviteId: "inv_ws_1",
    });
  });

  it("authenticates lobby socket when receiving an auth text frame", async () => {
    vi.mocked(verifyClientToken).mockResolvedValue({
      type: "success",
      persistentId: "pid_123",
    } as any);
    vi.mocked(defaultResolveCaller).mockResolvedValue({
      publicId: "auth_user.pub",
      username: "AuthUser",
      friends: [],
      clanTags: [],
    });

    const regSpy = vi.spyOn(service as any, "registerAuthenticatedLobbySocket");
    const ws = connectClient("/w0/lobbies?platform=web");

    (ws as any).emit(
      "message",
      JSON.stringify({ type: "auth", token: "valid_token" }),
    );

    await vi.waitFor(() => {
      expect(regSpy).toHaveBeenCalledWith(ws, "auth_user.pub");
    });
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it("terminates lobby socket when receiving non-auth or malformed messages", () => {
    const ws = connectClient("/w0/lobbies?platform=web");

    // 1. Malformed non-JSON
    (ws as any).emit("message", "invalid-frame");
    expect(ws.terminate).toHaveBeenCalledTimes(1);

    // 2. JSON without type: auth
    (ws as any).emit("message", JSON.stringify({ type: "ping" }));
    expect(ws.terminate).toHaveBeenCalledTimes(2);

    // 3. Auth with missing or non-string token
    (ws as any).emit("message", JSON.stringify({ type: "auth", token: 123 }));
    expect(ws.terminate).toHaveBeenCalledTimes(3);
  });

  it("removes socket from previous public ID when re-authenticating with new public ID", () => {
    const ws = connectClient("/w0/lobbies?platform=web");
    (service as any).registerAuthenticatedLobbySocket(ws, "user.one");
    expect(
      (service as any).lobbySocketsByPublicId.get("user.one")?.has(ws),
    ).toBe(true);

    (service as any).registerAuthenticatedLobbySocket(ws, "user.two");
    expect(
      (service as any).lobbySocketsByPublicId.get("user.one"),
    ).toBeUndefined();
    expect(
      (service as any).lobbySocketsByPublicId.get("user.two")?.has(ws),
    ).toBe(true);
  });
});
