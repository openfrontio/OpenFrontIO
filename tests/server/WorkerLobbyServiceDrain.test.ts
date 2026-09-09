import EventEmitter from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { PublicLobbyMessage } from "../../src/core/Schemas";
import { WorkerLobbyService } from "../../src/server/WorkerLobbyService";
import { mockLogger } from "../util/GameServerHarness";
import { decodeSentLobbyMessage } from "../util/Wire";

// The deployment-active flag's trip through the worker: it arrives on the
// master's lobbiesBroadcast, is stamped onto every full snapshot (both the
// connect-time priming send and broadcasts), and a flip forces a full so
// already-connected clients hear about a drain promptly.
describe("WorkerLobbyService deployment drain flag", () => {
  let service: WorkerLobbyService;

  beforeEach(() => {
    const gm = {
      publicLobbies: vi.fn().mockReturnValue([]),
      listedLobbies: vi.fn().mockReturnValue([]),
      game: vi.fn().mockReturnValue(null),
    };
    const server = new EventEmitter();
    service = new WorkerLobbyService(
      server as any,
      { handleUpgrade: vi.fn() } as any,
      gm as any,
      mockLogger(),
    );
    // Never touch the real process IPC channel: vitest forks use it.
    (service as any).sendToMaster = vi.fn();
  });

  function emitBroadcast(active: boolean | undefined, serverTime = 1000) {
    (service as any).handleMasterMessage({
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime,
        games: { ffa: [], team: [], special: [], hosted: [] },
      },
      active,
    });
  }

  function connectClient() {
    const ws = {
      send: vi.fn(),
      on: vi.fn(),
      readyState: WebSocket.OPEN,
    };
    (service as any).lobbiesWss.emit("connection", ws);
    return ws;
  }

  function fullsSent(ws: { send: ReturnType<typeof vi.fn> }) {
    return ws.send.mock.calls
      .map((c) => decodeSentLobbyMessage(c[0]))
      .filter(
        (m): m is Extract<PublicLobbyMessage, { type: "full" }> =>
          m.type === "full",
      );
  }

  function lastFull(ws: { send: ReturnType<typeof vi.fn> }) {
    const fulls = fullsSent(ws);
    return fulls[fulls.length - 1];
  }

  it("stamps active onto broadcast fulls and the connect-time priming send", () => {
    const ws = connectClient();
    emitBroadcast(true);
    expect(lastFull(ws)?.active).toBe(true);

    const late = connectClient();
    expect(fullsSent(late)).toHaveLength(1);
    expect(fullsSent(late)[0].active).toBe(true);
  });

  it("forces a full carrying active:false when the deployment drains", () => {
    const ws = connectClient();
    emitBroadcast(true);
    // Same lobby list again: without a flip this would be a counts delta.
    emitBroadcast(true, 1001);
    expect(fullsSent(ws)).toHaveLength(1);

    emitBroadcast(false, 1002);
    expect(fullsSent(ws)).toHaveLength(2);
    expect(lastFull(ws)?.active).toBe(false);
  });

  it("treats an absent flag as active (old master)", () => {
    const ws = connectClient();
    emitBroadcast(undefined);
    expect(lastFull(ws)?.active).toBe(true);
  });
});
