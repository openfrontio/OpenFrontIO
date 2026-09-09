import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { CloseCode, CloseReason } from "../../src/core/CloseCodes";
import { EventBus } from "../../src/core/EventBus";
import { ServerMessage } from "../../src/core/Schemas";
import {
  decodeClientMessage,
  encodeServerMessage,
} from "../../src/core/ZbinWire";
import { testGameConfig } from "../util/Wire";

// Transport's reconnect policy against a scripted WebSocket: which close
// codes retry and which end the session, how many sockets get opened, how
// far apart, and when the player is told it is over.

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
  // The rejoin frame is schema-validated on decode: token must be a UUID.
  getPlayToken: async () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
}));
vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class {},
}));
const showInGameConfirm = vi.fn<
  (message: string, options?: unknown) => Promise<boolean>
>(async () => false);
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: (message: string, options?: unknown) =>
    showInGameConfirm(message, options),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key} ${JSON.stringify(params)}`,
}));

import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { SendSpectateEvent, Transport } from "../../src/client/Transport";

type Script = (ws: FakeWebSocket) => void;

// Mirrors the browser socket closely enough for Transport: readyState
// constants, handler properties, async close. The per-connection `script`
// plays the server's side of the handshake.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];
  static script: Script = () => {};

  readonly url: string;
  readonly openedAt = Date.now();
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  sent: Uint8Array[] = [];
  clientClosed = false;
  private talk: ReturnType<typeof setInterval> | null = null;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    FakeWebSocket.script(this);
  }

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  // Client-initiated close. Browsers fire onclose asynchronously; Transport
  // nulls the handlers before closing, so this must not be observable.
  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.clientClosed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.stopTalking();
    setTimeout(() => this.onclose?.({ code: 1006, reason: "" }), 0);
  }

  serverOpen() {
    if (this.readyState !== FakeWebSocket.CONNECTING) return;
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverClose(code: number, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.stopTalking();
    this.onclose?.({ code, reason });
  }

  serverSend(msg: ServerMessage) {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    this.onmessage?.({ data: encodeServerMessage(msg, undefined).buffer });
  }

  // A healthy game server never goes quiet: a frame every second.
  serverTalk() {
    this.serverSend({ type: "ping" });
    this.talk ??= setInterval(() => this.serverSend({ type: "ping" }), 1000);
  }

  private stopTalking() {
    if (this.talk !== null) {
      clearInterval(this.talk);
      this.talk = null;
    }
  }

  static reset() {
    for (const ws of FakeWebSocket.instances) ws.stopTalking();
    FakeWebSocket.instances = [];
    FakeWebSocket.script = () => {};
  }
}

// Scripts.
const rejectAfter =
  (ms: number, code: number, reason = ""): Script =>
  (ws) => {
    setTimeout(() => ws.serverClose(code, reason), ms);
  };
const acceptAfter =
  (ms: number): Script =>
  (ws) => {
    setTimeout(() => ws.serverOpen(), ms);
  };
// Accept and keep sending, the way a live game does.
const acceptAndTalk =
  (ms: number): Script =>
  (ws) => {
    setTimeout(() => {
      ws.serverOpen();
      ws.serverTalk();
    }, ms);
  };
// Accept the socket, then refuse the join without ever sending a frame.
const acceptThenReject =
  (code: number, reason = ""): Script =>
  (ws) => {
    setTimeout(() => ws.serverOpen(), 10);
    setTimeout(() => ws.serverClose(code, reason), 20);
  };
// The first `failures` connections are refused, then the server is back.
function flakyThenHealthy(failures: number, code = 1006): Script {
  let n = 0;
  return (ws) => {
    n++;
    if (n <= failures) rejectAfter(50, code)(ws);
    else acceptAndTalk(10)(ws);
  };
}

// ClientGameRunner.onConnectionCheck, without the runner: every second, if
// the server has been silent for 5s, ask the transport to reconnect.
class Watchdog {
  private lastMessageTime = Date.now();
  readonly fired: number[] = [];
  private readonly interval: ReturnType<typeof setInterval>;

  constructor(private readonly transport: Transport) {
    this.interval = setInterval(() => {
      const now = Date.now();
      if (now - this.lastMessageTime > 5000) {
        this.lastMessageTime = now;
        this.fired.push(now);
        this.transport.reconnect();
      }
    }, 1000);
  }
  heard() {
    this.lastMessageTime = Date.now();
  }
  stop() {
    clearInterval(this.interval);
  }
}

function makeTransport() {
  const lobbyConfig = {
    gameID: "game1234",
    playerName: "tester",
    spectator: false,
  } as unknown as LobbyConfig;
  const eventBus = new EventBus();
  return { transport: new Transport(lobbyConfig, eventBus), eventBus };
}

// Fake timers run a 0ms timeout on the next tick, 1ms later; the immediate
// first retry lands there.
const IMMEDIATE_MS = 1;

// Offsets (ms) of every socket after the first, relative to the first.
function attemptOffsets(): number[] {
  const first = FakeWebSocket.instances[0].openedAt;
  return FakeWebSocket.instances.slice(1).map((ws) => ws.openedAt - first);
}

// The nominal schedule: each retry is scheduled from the moment the previous
// socket closed (`closeAfter` ms after it opened) with delay
// reconnectDelay(n), which is 0 for the first retry and then doubles from
// the base to the cap.
function expectedOffsets(closeAfter: number): number[] {
  const out: number[] = [];
  let t = 0;
  for (let n = 1; n <= Transport.RECONNECT_MAX_ATTEMPTS; n++) {
    const delay =
      n === 1
        ? IMMEDIATE_MS
        : Math.min(
            Transport.RECONNECT_MAX_DELAY_MS,
            Transport.RECONNECT_BASE_DELAY_MS * 2 ** (n - 2),
          );
    t += closeAfter + delay;
    out.push(t);
  }
  return out;
}

describe("Transport reconnect policy", () => {
  let transport: Transport;
  let eventBus: EventBus;
  let onconnect: Mock<() => void>;
  let watchdog: Watchdog;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    showInGameConfirm.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Jitter factor of exactly 1.0 so the nominal schedule is asserted.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    ({ transport, eventBus } = makeTransport());
    onconnect = vi.fn<() => void>();
  });

  afterEach(() => {
    watchdog?.stop();
    transport.leaveGame();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function connect() {
    transport.connect(onconnect, (msg) => {
      watchdog?.heard();
      void msg;
    });
    watchdog = new Watchdog(transport);
  }

  describe("close codes", () => {
    it.each([
      ["a full lobby", CloseCode.LobbyFull, CloseReason.LobbyFull],
      ["a corrupted frame", CloseCode.ProtocolError, CloseReason.ProtocolError],
      ["a ban", CloseCode.Banned, CloseReason.Banned],
      [
        "a rejected bot check",
        CloseCode.Unauthorized,
        CloseReason.TurnstileFailed,
      ],
      ["a missing game", CloseCode.GameNotFound, CloseReason.GameNotFound],
      ["an ended game", CloseCode.GameNotFound, CloseReason.GameEnded],
    ])("tells the player once and gives up on %s", (_label, code, reason) => {
      FakeWebSocket.script = rejectAfter(50, code, reason);
      connect();
      vi.advanceTimersByTime(120_000);

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(showInGameConfirm).toHaveBeenCalledOnce();
      expect(showInGameConfirm.mock.calls[0][0]).toBe(
        `error_modal.connection_refused {"reason":"${reason}"}`,
      );
    });

    it.each([
      ["a server fault", CloseCode.InternalError],
      ["a retry-later close", CloseCode.TryAgainLater],
      ["an abrupt drop with no close frame", 1006],
    ])("retries immediately after %s", (_label, code) => {
      FakeWebSocket.script = rejectAfter(50, code);
      connect();
      vi.advanceTimersByTime(60);

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.instances[1].openedAt).toBe(50 + IMMEDIATE_MS);
      expect(showInGameConfirm).not.toHaveBeenCalled();
    });
  });

  describe("bounded, backed-off retries", () => {
    it("does not storm a server that refuses every connection", () => {
      // Before the budget, this loop (onclose -> reconnect -> onclose, with
      // the 5s watchdog stacking attempts on top) opened a socket every
      // round trip for as long as the outage lasted.
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(300_000);

      // 1 initial + the retry budget, and not one more.
      expect(FakeWebSocket.instances).toHaveLength(
        1 + Transport.RECONNECT_MAX_ATTEMPTS,
      );
    });

    it("retries at once, then spaces attempts out exponentially up to the cap", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(300_000);

      expect(attemptOffsets()).toEqual(expectedOffsets(50));
    });

    it("applies +/-25% jitter to each delay after the first", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      (Math.random as Mock<() => number>).mockReturnValue(0);
      connect();
      vi.advanceTimersByTime(2_000);
      const low = attemptOffsets()[1];

      FakeWebSocket.reset();
      transport.leaveGame();
      watchdog.stop();
      ({ transport, eventBus } = makeTransport());
      (Math.random as Mock<() => number>).mockReturnValue(1);
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(2_000);
      const high = attemptOffsets()[1];

      // Retry 2 is scheduled when retry 1's socket closes, 50ms after it
      // opened.
      const closedAt = 50 + IMMEDIATE_MS + 50;
      const base = Transport.RECONNECT_BASE_DELAY_MS;
      expect(low).toBe(closedAt + base * 0.75);
      expect(high).toBe(closedAt + base * 1.25);
    });

    it("keeps counting when the socket opens but the server refuses the join", () => {
      // Opening is not recovering: a server that accepts the socket and
      // then rejects the join with a retryable code must not get retried
      // forever.
      FakeWebSocket.script = acceptThenReject(
        CloseCode.InternalError,
        CloseReason.InvalidToken,
      );
      connect();
      vi.advanceTimersByTime(300_000);

      expect(FakeWebSocket.instances).toHaveLength(
        1 + Transport.RECONNECT_MAX_ATTEMPTS,
      );
      expect(showInGameConfirm).toHaveBeenCalledOnce();
    });

    it("bounds the watchdog too when the socket opens but stays silent", () => {
      // A half-open connection: the server accepts and never speaks. onclose
      // never fires, so the only thing that notices is the watchdog. Before
      // the budget it opened a fresh socket every 5s forever.
      FakeWebSocket.script = acceptAfter(10);
      connect();
      vi.advanceTimersByTime(300_000);

      expect(watchdog.fired.length).toBeGreaterThan(
        Transport.RECONNECT_MAX_ATTEMPTS,
      );
      expect(FakeWebSocket.instances).toHaveLength(
        1 + Transport.RECONNECT_MAX_ATTEMPTS,
      );
      expect(showInGameConfirm).toHaveBeenCalledOnce();
    });

    it("lets one owner schedule: an attempt in flight is not preempted", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(60);
      // Socket 1 closed at t=50; retry 1 opened at once and is CONNECTING.
      expect(FakeWebSocket.instances).toHaveLength(2);
      transport.reconnect();
      transport.reconnect();
      vi.advanceTimersByTime(30);

      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it("drops a scheduled retry when the silent socket speaks before it fires", () => {
      // Retry 1 is immediate, so arm a delayed one: the first socket is
      // refused, the second opens and stays quiet until the watchdog
      // schedules retry 2, then the server recovers before it fires. The
      // retry must not tear down the socket that just came back.
      let n = 0;
      FakeWebSocket.script = (ws) => {
        n++;
        if (n === 1) rejectAfter(50, 1006)(ws);
        else acceptAfter(10)(ws);
      };
      connect();
      vi.advanceTimersByTime(6_500);
      expect(watchdog.fired).toHaveLength(1);
      const socket = FakeWebSocket.instances[1];
      expect(socket.readyState).toBe(FakeWebSocket.OPEN);

      socket.serverTalk();
      vi.advanceTimersByTime(60_000);

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(socket.readyState).toBe(FakeWebSocket.OPEN);
      expect(showInGameConfirm).not.toHaveBeenCalled();
    });
  });

  describe("recovery", () => {
    it("resumes through onconnect, the rejoin path", async () => {
      FakeWebSocket.script = flakyThenHealthy(3);
      onconnect.mockImplementation(() => {
        void transport.rejoinGame(42);
      });
      connect();
      vi.advanceTimersByTime(10_000);

      const healthy = FakeWebSocket.instances[3];
      expect(healthy.readyState).toBe(FakeWebSocket.OPEN);
      expect(onconnect).toHaveBeenCalledOnce();
      // rejoinGame awaits the play token before sending, and the 5s ping
      // may land first.
      await Promise.resolve();
      await Promise.resolve();
      const frames = healthy.sent.map((f) => decodeClientMessage(f, undefined));
      expect(frames).toContainEqual(
        expect.objectContaining({
          type: "rejoin",
          gameID: "game1234",
          lastTurn: 42,
        }),
      );
      expect(showInGameConfirm).not.toHaveBeenCalled();
    });

    it("resets the budget on the first server frame", () => {
      FakeWebSocket.script = flakyThenHealthy(3);
      connect();
      vi.advanceTimersByTime(4_000);
      const healthy = FakeWebSocket.instances[3];
      expect(healthy.readyState).toBe(FakeWebSocket.OPEN);

      // One frame is enough: the next outage starts fresh, its first retry
      // immediate again rather than where the last run left off.
      const before = FakeWebSocket.instances.length;
      FakeWebSocket.script = rejectAfter(50, 1006);
      const dropAt = Date.now();
      healthy.serverClose(1006);
      vi.advanceTimersByTime(10);

      expect(FakeWebSocket.instances).toHaveLength(before + 1);
      expect(FakeWebSocket.instances[before].openedAt).toBe(dropAt);
    });

    it("does not burn the budget on watchdog reconnects of a healthy game", () => {
      FakeWebSocket.script = acceptAndTalk(10);
      connect();
      for (let i = 0; i < 15; i++) {
        vi.advanceTimersByTime(31_000);
        transport.reconnect();
      }
      vi.advanceTimersByTime(100);

      expect(FakeWebSocket.instances).toHaveLength(16);
      expect(showInGameConfirm).not.toHaveBeenCalled();
    });

    it("never shows the terminal message on a single blip", () => {
      FakeWebSocket.script = flakyThenHealthy(1);
      connect();
      vi.advanceTimersByTime(60_000);

      expect(showInGameConfirm).not.toHaveBeenCalled();
      expect(FakeWebSocket.instances).toHaveLength(2);
    });
  });

  describe("terminal state", () => {
    it("tells the player once, only after the budget is spent, and stays shut", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();

      // Still trying: no message yet.
      vi.advanceTimersByTime(5_000);
      expect(showInGameConfirm).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300_000);
      expect(showInGameConfirm).toHaveBeenCalledOnce();
      expect(showInGameConfirm.mock.calls[0][0]).toBe(
        "error_modal.connection_lost",
      );

      // The watchdog keeps asking and a send finds the socket closed;
      // nothing more happens.
      const sockets = FakeWebSocket.instances.length;
      eventBus.emit(new SendSpectateEvent(true));
      vi.advanceTimersByTime(120_000);
      expect(FakeWebSocket.instances).toHaveLength(sockets);
      expect(showInGameConfirm).toHaveBeenCalledOnce();
    });

    it("offers the menu from the terminal dialog", async () => {
      const href = { value: "/w0/game/game1234" };
      Object.defineProperty(window, "location", {
        value: {
          get href() {
            return href.value;
          },
          set href(v: string) {
            href.value = v;
          },
        },
        writable: true,
        configurable: true,
      });
      showInGameConfirm.mockResolvedValueOnce(true);
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(300_000);
      await Promise.resolve();

      expect(showInGameConfirm.mock.calls[0][1]).toMatchObject({
        confirmText: "win_modal.exit",
        cancelText: "common.close",
      });
      expect(href.value).toBe("/");
    });

    it("does not reconnect after leaveGame", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(60);
      transport.leaveGame();
      vi.advanceTimersByTime(120_000);

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(showInGameConfirm).not.toHaveBeenCalled();
    });

    it("preserves FIFO intent ordering across connection and does not send intents before handshake", async () => {
      const { transport, eventBus } = makeTransport();
      (transport as any).lobbyConfig.turnstileToken = "dummy-turnstile";
      let onconnectCalled = false;
      transport.connect(
        () => {
          onconnectCalled = true;
          void transport.joinGame();
        },
        () => {},
      );

      const ws = FakeWebSocket.instances[0];
      expect(ws.readyState).toBe(FakeWebSocket.CONNECTING);

      // Intent A sent while CONNECTING
      eventBus.emit(new SendSpectateEvent(true));

      // Socket opens, onconnect runs (sends join)
      ws.serverOpen();
      expect(onconnectCalled).toBe(true);

      // Await token fetch promise so join message is sent
      await Promise.resolve();

      // Intent B sent while socket is OPEN, but before server handshake frame
      eventBus.emit(new SendSpectateEvent(false));

      // Before handshake, only join message should have been sent
      const sentBeforeHandshake = ws.sent.map((f) =>
        decodeClientMessage(f, undefined),
      );
      expect(sentBeforeHandshake.map((m) => m.type)).toEqual(["join"]);

      // Server acknowledges with start
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

      // After handshake, intent A and intent B are flushed in strict FIFO order
      const sentAfterHandshake = ws.sent.map((f) =>
        decodeClientMessage(f, undefined),
      );
      expect(sentAfterHandshake.map((m) => m.type)).toEqual([
        "join",
        "spectate",
        "spectate",
      ]);
      expect((sentAfterHandshake[1] as any).spectator).toBe(true);
      expect((sentAfterHandshake[2] as any).spectator).toBe(false);
    });
  });
});
