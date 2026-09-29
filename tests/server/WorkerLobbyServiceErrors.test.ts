import EventEmitter from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import { mockLogger } from "../util/GameServerHarness";

// A peer's protocol violation (ws raises WS_ERR_*) is not a server fault and
// is logged at warn; any other socket error stays at error.
describe("WorkerLobbyService lobbies socket errors", () => {
  let service: WorkerLobbyService;
  let log: ReturnType<typeof mockLogger>;

  beforeEach(() => {
    const gm = {
      publicLobbies: vi.fn().mockReturnValue([]),
      listedLobbies: vi.fn().mockReturnValue([]),
      game: vi.fn().mockReturnValue(null),
      activeGames: vi.fn().mockReturnValue(0),
    };
    log = mockLogger();
    service = new WorkerLobbyService(
      new EventEmitter() as any,
      { handleUpgrade: vi.fn() } as any,
      gm as any,
      log,
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
      close: vi.fn(),
    };
    (service as any).lobbiesWss.emit("connection", ws, undefined);
    return {
      ws,
      emit: (event: string, arg: unknown) => handlers.get(event)?.(arg),
    };
  }

  it("logs a ws protocol error from the peer at warn and drops the client", () => {
    const { ws, emit } = connectClient();
    const error = Object.assign(
      new RangeError("Invalid WebSocket frame: invalid status code 1006"),
      { code: "WS_ERR_INVALID_CLOSE_CODE" },
    );
    emit("error", error);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "Lobbies WebSocket peer protocol error",
      { code: "WS_ERR_INVALID_CLOSE_CODE" },
    );
    expect(service.connectedClients()).toBe(0);
    expect(ws.close).toHaveBeenCalled();
  });

  it("keeps any other socket error at error", () => {
    const { emit } = connectClient();
    const error = new Error("boom");
    emit("error", error);
    expect(log.error).toHaveBeenCalledWith("Lobbies WebSocket error:", error);
    expect(log.warn).not.toHaveBeenCalled();
    expect(service.connectedClients()).toBe(0);
  });
});
