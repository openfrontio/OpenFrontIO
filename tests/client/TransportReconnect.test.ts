import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import { ServerMessage } from "../../src/core/Schemas";
import {
  decodeClientMessage,
  encodeServerMessage,
} from "../../src/core/ZbinWire";

// Transport's reconnect policy against a scripted WebSocket. The real
// symptom (OPE-175: "loses the game on a blip and never gets back in") needs
// a packaged build on real hardware; what can be pinned down headless is the
// schedule — how many sockets get opened, how far apart, and when the player
// is told it is over.

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    workerPath: () => "w0",
    serverWsBase: () => "ws://game.test",
  },
}));
vi.mock("../../src/client/Auth", () => ({
  // The rejoin frame is schema-validated on decode: token must be a UUID.
  getPlayToken: async () => "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5",
}));
vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class {},
}));
const showInGameAlert = vi.fn<(message: string) => Promise<boolean>>(
  async () => true,
);
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: (message: string) => showInGameAlert(message),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key} ${JSON.stringify(params)}`,
}));

import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { Transport } from "../../src/client/Transport";

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
  return new Transport(lobbyConfig, new EventBus());
}

// Offsets (ms) of every socket after the first, relative to the first.
function attemptOffsets(): number[] {
  const first = FakeWebSocket.instances[0].openedAt;
  return FakeWebSocket.instances.slice(1).map((ws) => ws.openedAt - first);
}

describe("Transport reconnect policy", () => {
  let transport: Transport;
  let onconnect: Mock<() => void>;
  let watchdog: Watchdog;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    showInGameAlert.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Jitter factor of exactly 1.0 so the nominal schedule is asserted.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    transport = makeTransport();
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

  describe("bounded, backed-off retries", () => {
    it("does not storm a server that refuses every connection", () => {
      // The pre-fix loop: onclose -> reconnect -> onclose ..., with the
      // 5s watchdog stacking attempts on top. Every refused connection
      // cost the server a handshake and the client a 50ms round trip, so
      // an outage produced a new socket every 50ms, indefinitely.
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(120_000);

      // 1 initial + the retry budget, and not one more.
      expect(FakeWebSocket.instances.length).toBe(
        1 + Transport.RECONNECT_MAX_ATTEMPTS,
      );
    });

    it("spaces attempts out exponentially up to the cap", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(120_000);

      // Each retry is scheduled from the moment the previous socket closed
      // (50ms after it opened) with delay min(cap, base * 2^(n-1)).
      const expected: number[] = [];
      let t = 0;
      for (let n = 1; n <= Transport.RECONNECT_MAX_ATTEMPTS; n++) {
        const delay = Math.min(
          Transport.RECONNECT_MAX_DELAY_MS,
          Transport.RECONNECT_BASE_DELAY_MS * 2 ** (n - 1),
        );
        t += 50 + delay;
        expected.push(t);
      }
      expect(attemptOffsets()).toEqual(expected);
    });

    it("applies +/-25% jitter to each delay", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      (Math.random as ReturnType<typeof vi.fn>).mockReturnValue(0);
      connect();
      vi.advanceTimersByTime(2_000);
      const low = attemptOffsets()[0];

      FakeWebSocket.reset();
      transport.leaveGame();
      transport = makeTransport();
      watchdog.stop();
      (Math.random as ReturnType<typeof vi.fn>).mockReturnValue(1);
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(2_000);
      const high = attemptOffsets()[0];

      const base = Transport.RECONNECT_BASE_DELAY_MS;
      expect(low).toBe(50 + base * 0.75);
      expect(high).toBe(50 + base * 1.25);
    });

    it("bounds the watchdog too when the socket opens but stays silent", () => {
      // A half-open connection: the server accepts and never speaks. onclose
      // never fires, so the only thing that notices is the watchdog. Before
      // the fix it opened a fresh socket every 5s forever.
      FakeWebSocket.script = acceptAfter(10);
      connect();
      vi.advanceTimersByTime(300_000);

      expect(watchdog.fired.length).toBeGreaterThan(
        Transport.RECONNECT_MAX_ATTEMPTS,
      );
      expect(FakeWebSocket.instances.length).toBe(
        1 + Transport.RECONNECT_MAX_ATTEMPTS,
      );
    });

    it("lets one owner schedule: onclose and the watchdog in the same window make one socket", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(60);
      // Socket 1 closed at t=50; retry 1 is pending. The watchdog asks too.
      transport.reconnect();
      transport.reconnect();
      vi.advanceTimersByTime(Transport.RECONNECT_BASE_DELAY_MS + 10);

      expect(FakeWebSocket.instances.length).toBe(2);
    });
  });

  describe("recovery", () => {
    it("resumes through onconnect (the rejoin path) and resets the budget", async () => {
      FakeWebSocket.script = flakyThenHealthy(3);
      onconnect.mockImplementation(() => {
        void transport.rejoinGame(42);
      });
      connect();
      vi.advanceTimersByTime(10_000);
      await vi.runAllTicks();

      const healthy = FakeWebSocket.instances[3];
      expect(healthy.readyState).toBe(FakeWebSocket.OPEN);
      expect(onconnect).toHaveBeenCalledTimes(1);
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
      expect(showInGameAlert).not.toHaveBeenCalled();

      // The next outage starts a fresh budget: first retry is back at the
      // base delay, not where the last run left off.
      const before = FakeWebSocket.instances.length;
      FakeWebSocket.script = rejectAfter(50, 1006);
      const dropAt = Date.now();
      healthy.serverClose(1006);
      vi.advanceTimersByTime(Transport.RECONNECT_BASE_DELAY_MS + 10);
      expect(FakeWebSocket.instances.length).toBe(before + 1);
      expect(FakeWebSocket.instances[before].openedAt - dropAt).toBe(
        Transport.RECONNECT_BASE_DELAY_MS,
      );
    });

    it("never shows the terminal message on a single blip", () => {
      FakeWebSocket.script = flakyThenHealthy(1);
      connect();
      vi.advanceTimersByTime(60_000);

      expect(showInGameAlert).not.toHaveBeenCalled();
      expect(FakeWebSocket.instances.length).toBe(2);
    });
  });

  describe("terminal state", () => {
    it("tells the player once, only after the budget is spent, and stops", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();

      // Still trying: no message yet.
      vi.advanceTimersByTime(5_000);
      expect(showInGameAlert).not.toHaveBeenCalled();

      vi.advanceTimersByTime(120_000);
      expect(showInGameAlert).toHaveBeenCalledTimes(1);
      expect(showInGameAlert).toHaveBeenCalledWith(
        "error_modal.connection_lost",
      );

      // The watchdog keeps asking; nothing more happens.
      const sockets = FakeWebSocket.instances.length;
      vi.advanceTimersByTime(120_000);
      expect(FakeWebSocket.instances.length).toBe(sockets);
      expect(showInGameAlert).toHaveBeenCalledTimes(1);
    });

    it("keeps the 1002 refusal modal and does not retry after it", () => {
      FakeWebSocket.script = rejectAfter(50, 1002, "Game not found");
      connect();
      vi.advanceTimersByTime(120_000);

      expect(FakeWebSocket.instances.length).toBe(1);
      expect(showInGameAlert).toHaveBeenCalledTimes(1);
      expect(showInGameAlert).toHaveBeenCalledWith(
        'error_modal.connection_refused {"reason":"Game not found"}',
      );
    });

    it("does not reconnect after leaveGame", () => {
      FakeWebSocket.script = rejectAfter(50, 1006);
      connect();
      vi.advanceTimersByTime(60);
      transport.leaveGame();
      vi.advanceTimersByTime(120_000);

      expect(FakeWebSocket.instances.length).toBe(1);
      expect(showInGameAlert).not.toHaveBeenCalled();
    });
  });
});
