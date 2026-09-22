import EventEmitter from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import { mockLogger } from "../util/GameServerHarness";

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

  function connectClient() {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const ws = {
      send: vi.fn(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers.set(event, cb);
      }),
      readyState: WebSocket.OPEN as number,
      close: () => handlers.get("close")?.(),
    };
    (service as any).lobbiesWss.emit("connection", ws);
    return ws;
  }

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
});
