import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import { ServerMessage } from "../../src/core/Schemas";
import {
  createGameWireContext,
  decodeClientMessage,
  encodeServerMessage,
} from "../../src/core/ZbinWire";
import { testGameConfig } from "../util/Wire";

// Transport's send paths: intent events on the bus leave the socket as
// decodable frames (or reach the local server in singleplayer), and the
// guards around a torn-down socket stay quiet instead of throwing.

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    workerPath: () => "w0",
    serverWsBase: () => "ws://game.test",
    gameWorkerPath: () => "w0",
    gameWsBase: () => "ws://game.test",
    gameHttpBase: () => "http://game.test",
    gitCommit: () => "test-commit",
  },
}));
vi.mock("../../src/client/Auth", () => ({
  getPlayToken: async () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
}));
const localServer = vi.hoisted(() => ({
  onMessage: vi.fn(),
  start: vi.fn(),
  updateCallback: vi.fn(),
  endGame: vi.fn(),
}));
vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class {
    onMessage = localServer.onMessage;
    start = localServer.start;
    updateCallback = localServer.updateCallback;
    endGame = localServer.endGame;
  },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: async () => false,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  homeHref: () => "/",
}));

import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import {
  CancelAttackIntentEvent,
  SendAttackIntentEvent,
  SendDonateGoldIntentEvent,
  SendHashEvent,
  SendSpawnIntentEvent,
  SendWinnerEvent,
  Transport,
} from "../../src/client/Transport";
import type { PlayerView } from "../../src/client/view";

// Just enough of the browser socket for Transport: readyState constants,
// handler properties, captured outgoing frames.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sent: Uint8Array[] = [];
  clientClosed = false;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.clientClosed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverSend(msg: ServerMessage) {
    this.onmessage?.({ data: encodeServerMessage(msg, undefined).buffer });
  }
}

function makeTransport(extra: Partial<LobbyConfig> = {}) {
  const lobbyConfig = {
    gameID: "game1234",
    playerName: "tester",
    spectator: false,
    ...extra,
  } as unknown as LobbyConfig;
  const eventBus = new EventBus();
  return { transport: new Transport(lobbyConfig, eventBus), eventBus };
}

// Connect, open the socket, and complete the join handshake; gameplay
// messages are buffered until the server's start frame proves admission.
function handshake(transport: Transport): FakeWebSocket {
  transport.connect(
    () => {},
    () => {},
  );
  const ws = FakeWebSocket.instances.at(-1)!;
  ws.serverOpen();
  ws.serverSend({
    type: "start",
    turns: [],
    lobbyCreatedAt: 1_700_000_000_000,
    myClientID: "c0000001",
    gameStartInfo: {
      gameID: "game1234",
      lobbyCreatedAt: 1_700_000_000_000,
      config: testGameConfig(),
      players: [],
      tribes: [],
    },
  });
  return ws;
}

// Decode with the same (empty-roster) dictionary the transport seeded from
// the start message.
function decodeFrames(ws: FakeWebSocket) {
  return ws.sent.map((f) => decodeClientMessage(f, createGameWireContext([])));
}

describe("Transport send paths", () => {
  let transports: Transport[];

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    localServer.onMessage.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    transports = [];
  });

  afterEach(() => {
    for (const t of transports) t.leaveGame();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function connected() {
    const made = makeTransport();
    transports.push(made.transport);
    return { ...made, ws: handshake(made.transport) };
  }

  describe("intents", () => {
    it("turns bus intent events into intent frames the server can decode", () => {
      const { eventBus, ws } = connected();
      eventBus.emit(new SendSpawnIntentEvent(123));
      eventBus.emit(new SendAttackIntentEvent("player01", 50));
      eventBus.emit(
        new SendDonateGoldIntentEvent(
          { id: () => "player02" } as unknown as PlayerView,
          25n,
        ),
      );
      eventBus.emit(new CancelAttackIntentEvent("atk-1"));

      expect(decodeFrames(ws)).toEqual([
        { type: "intent", intent: { type: "spawn", tile: 123 } },
        {
          type: "intent",
          intent: { type: "attack", targetID: "player01", troops: 50 },
        },
        {
          type: "intent",
          intent: { type: "donate_gold", recipient: "player02", gold: 25 },
        },
        {
          type: "intent",
          intent: { type: "cancel_attack", attackID: "atk-1" },
        },
      ]);
    });

    it("does nothing when an intent arrives before any socket exists", () => {
      const { transport, eventBus } = makeTransport();
      transports.push(transport);

      expect(() => eventBus.emit(new SendSpawnIntentEvent(123))).not.toThrow();
      expect(FakeWebSocket.instances).toHaveLength(0);
    });
  });

  describe("winner and hash", () => {
    it("sends the winner over an open socket", () => {
      const { eventBus, ws } = connected();
      eventBus.emit(new SendWinnerEvent(["player", "player01"], {}));

      expect(decodeFrames(ws)).toContainEqual({
        type: "winner",
        winner: ["player", "player01"],
        allPlayersStats: {},
      });
    });

    it("sends the hash over an open socket", () => {
      const { eventBus, ws } = connected();
      eventBus.emit(new SendHashEvent(10, 42));

      expect(decodeFrames(ws)).toContainEqual({
        type: "hash",
        turnNumber: 10,
        hash: 42,
      });
    });

    it("forwards the winner to the local server in singleplayer", () => {
      const { transport, eventBus } = makeTransport({
        gameRecord: {} as LobbyConfig["gameRecord"],
      });
      transports.push(transport);
      transport.connect(
        () => {},
        () => {},
      );
      eventBus.emit(new SendWinnerEvent(["player", "player01"], {}));

      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(localServer.onMessage).toHaveBeenCalledWith({
        type: "winner",
        winner: ["player", "player01"],
        allPlayersStats: {},
      });
    });
  });

  describe("torn-down socket guards", () => {
    // The browser can fire a queued handler after killExistingSocket nulled
    // the transport's reference; each guard must bail without acting.

    it("ignores onopen when the socket was torn down before it fired", () => {
      const onconnect = vi.fn();
      const { transport } = makeTransport();
      transports.push(transport);
      transport.connect(onconnect, () => {});
      const ws = FakeWebSocket.instances[0];

      (transport as any).socket = null;
      ws.serverOpen();

      expect(onconnect).not.toHaveBeenCalled();
    });

    it("ignores onerror when the socket was torn down before it fired", () => {
      const { transport } = makeTransport();
      transports.push(transport);
      transport.connect(
        () => {},
        () => {},
      );
      const ws = FakeWebSocket.instances[0];

      (transport as any).socket = null;
      ws.onerror?.(new Error("boom"));

      expect(ws.clientClosed).toBe(false);
    });

    it("drops a frame that fails to decode without reaching the game", () => {
      const onmessage = vi.fn();
      const { transport } = makeTransport();
      transports.push(transport);
      transport.connect(() => {}, onmessage);
      const ws = FakeWebSocket.instances[0];
      ws.serverOpen();

      ws.onmessage?.({ data: new Uint8Array([255, 255, 255]).buffer });

      expect(onmessage).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        "Error in onmessage handler:",
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
