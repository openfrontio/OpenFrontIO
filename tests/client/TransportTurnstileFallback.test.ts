import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import { EventBus } from "@openfront/shared/EventBus";
import { ServerMessage } from "@openfront/shared/WireSchemas";
import {
  decodeClientMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import {
  TURNSTILE_CANCELLED_CODE,
  TurnstileError,
} from "../../src/client/TurnstileToken";

const modalMocks = vi.hoisted(() => ({
  showInGameConfirm:
    vi.fn<
      (
        message: string,
        options?: { confirmText?: string; cancelText?: string },
      ) => Promise<boolean>
    >(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: modalMocks.showInGameConfirm,
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string, vars?: { reason?: string }) =>
    vars?.reason !== undefined ? `${key}:${vars.reason}` : key,
  ),
  homeHref: vi.fn(() => "/"),
}));

const PLAY_TOKEN = "8f1d2c3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
const CREATOR_TOKEN = "11111111-2222-4333-8444-555555555555";

vi.mock("../../src/client/Auth", () => ({
  getPlayToken: vi.fn(async () => PLAY_TOKEN),
}));

vi.mock("../../src/client/LocalServer", () => ({
  LocalServer: class {},
}));

vi.mock("src/client/ClientEnv", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/ClientEnv")>();
  return {
    NoServerError: actual.NoServerError,
    ClientEnv: {
      workerPath: vi.fn(() => "w0"),
      serverWsBase: vi.fn(() => "ws://game.test"),
      gameWorkerPath: vi.fn(() => "w0"),
      gameWsBase: vi.fn(() => "ws://game.test"),
      gameHttpBase: vi.fn(() => "http://game.test"),
      gameNavigateBase: vi.fn(() => "http://game.test"),
      gitCommit: vi.fn(() => "test-commit"),
    },
  };
});

import { Transport } from "../../src/client/Transport";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "";
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
  }

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverSend(msg: ServerMessage) {
    const encoded = encodeServerMessage(msg, undefined);
    const buffer = encoded.slice().buffer;
    this.onmessage?.({ data: buffer } as MessageEvent);
  }

  serverClose(code: number, reason: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const sockets: FakeWebSocket[] = [];

function makeLobbyConfig(overrides: Partial<LobbyConfig> = {}): LobbyConfig {
  return {
    cosmetics: {},
    playerName: "tester",
    playerClanTag: null,
    playerRole: null,
    gameID: "abcd1234",
    turnstileToken: null,
    ...overrides,
  };
}

function connectWithJoin(config: LobbyConfig): Transport {
  const transport = new Transport(config, new EventBus());
  transport.connect(
    () => {
      void transport.joinGame();
    },
    () => undefined,
  );
  return transport;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Transport Turnstile fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    modalMocks.showInGameConfirm.mockReset();
    modalMocks.showInGameConfirm.mockResolvedValue(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([CloseReason.TurnstilePassRequired, CloseReason.TurnstileFailed])(
    "retries once with a fresh Turnstile token on %s while preserving creatorToken",
    async (reason) => {
      const pending = deferred<string | null>();
      let capturedSignal: AbortSignal | undefined;
      const refreshTurnstileToken = vi.fn((signal: AbortSignal) => {
        capturedSignal = signal;
        return pending.promise;
      });
      const config = makeLobbyConfig({
        turnstileToken: null,
        creatorToken: CREATOR_TOKEN,
        refreshTurnstileToken,
      });

      const transport = connectWithJoin(config);
      expect(sockets).toHaveLength(1);

      sockets[0].serverOpen();
      await flushMicrotasks();

      const firstJoin = decodeClientMessage(sockets[0].sent[0], undefined);
      expect(firstJoin).toMatchObject({
        type: "join",
        token: CREATOR_TOKEN,
        turnstileToken: null,
      });
      expect(config.creatorToken).toBeUndefined();

      sockets[0].serverClose(CloseCode.Unauthorized, reason);

      expect(refreshTurnstileToken).toHaveBeenCalledTimes(1);
      expect(capturedSignal?.aborted).toBe(false);
      expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();

      // Watchdog reconnects and ping timers must not open a socket while awaiting Turnstile.
      transport.reconnect();
      vi.advanceTimersByTime(10_000);
      expect(sockets).toHaveLength(1);
      expect(sockets[0].sent).toHaveLength(1);

      pending.resolve("fresh-turnstile-token");
      await flushMicrotasks();

      expect(config.turnstileToken).toBe("fresh-turnstile-token");
      expect(sockets).toHaveLength(2);
      expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();

      sockets[1].serverOpen();
      await flushMicrotasks();

      const retryJoin = decodeClientMessage(sockets[1].sent[0], undefined);
      expect(retryJoin).toMatchObject({
        type: "join",
        token: CREATOR_TOKEN,
        turnstileToken: "fresh-turnstile-token",
      });

      // Admission deletes creatorToken so subsequent reconnects never reuse it.
      sockets[1].serverSend({
        type: "lobby_info",
        myClientID: "c0000001",
        lobby: {
          gameID: "abcd1234",
          serverTime: 1_700_000_000_000,
        },
      });
      expect(config.creatorToken).toBeUndefined();
    },
  );

  it("refreshes play token instead of resending creatorToken after a non-Turnstile pre-admission close", async () => {
    const config = makeLobbyConfig({
      turnstileToken: null,
      creatorToken: CREATOR_TOKEN,
      refreshTurnstileToken: vi.fn(async () => "fresh-token"),
    });

    connectWithJoin(config);
    expect(sockets).toHaveLength(1);

    sockets[0].serverOpen();
    await flushMicrotasks();

    const firstJoin = decodeClientMessage(sockets[0].sent[0], undefined);
    expect(firstJoin).toMatchObject({ type: "join", token: CREATOR_TOKEN });

    // Non-Turnstile retryable close (e.g., expired creator JWT rejected as InvalidToken).
    sockets[0].serverClose(CloseCode.InternalError, CloseReason.InvalidToken);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    sockets[1].serverOpen();
    await flushMicrotasks();

    const reconnectJoin = decodeClientMessage(sockets[1].sent[0], undefined);
    expect(reconnectJoin).toMatchObject({
      type: "join",
      token: PLAY_TOKEN,
    });
  });

  it("uses a fresh play token instead of creatorToken when reconnecting after admission", async () => {
    const config = makeLobbyConfig({
      turnstileToken: null,
      creatorToken: CREATOR_TOKEN,
      refreshTurnstileToken: vi.fn(async () => "fresh-token"),
    });

    connectWithJoin(config);
    expect(sockets).toHaveLength(1);

    sockets[0].serverOpen();
    await flushMicrotasks();

    const firstJoin = decodeClientMessage(sockets[0].sent[0], undefined);
    expect(firstJoin).toMatchObject({ type: "join", token: CREATOR_TOKEN });

    sockets[0].serverSend({
      type: "lobby_info",
      myClientID: "c0000001",
      lobby: {
        gameID: "abcd1234",
        serverTime: 1_700_000_000_000,
      },
    });

    // Retryable disconnect after admission must reconnect using PLAY_TOKEN, not CREATOR_TOKEN.
    sockets[0].serverClose(1006, "");
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    sockets[1].serverOpen();
    await flushMicrotasks();

    const reconnectJoin = decodeClientMessage(sockets[1].sent[0], undefined);
    expect(reconnectJoin).toMatchObject({
      type: "join",
      token: PLAY_TOKEN,
    });
  });

  it.each([CloseReason.TurnstileFailed, CloseReason.TurnstilePassRequired])(
    "does not retry a third time if the retried connection also closes with %s",
    async (secondReason) => {
      const refreshTurnstileToken = vi.fn(async () => "fresh-turnstile-token");
      const config = makeLobbyConfig({
        turnstileToken: null,
        refreshTurnstileToken,
      });

      connectWithJoin(config);
      sockets[0].serverClose(
        CloseCode.Unauthorized,
        CloseReason.TurnstilePassRequired,
      );
      await flushMicrotasks();

      expect(sockets).toHaveLength(2);
      expect(refreshTurnstileToken).toHaveBeenCalledTimes(1);

      sockets[1].serverClose(CloseCode.Unauthorized, secondReason);
      await flushMicrotasks();

      expect(refreshTurnstileToken).toHaveBeenCalledTimes(1);
      expect(sockets).toHaveLength(2);
      expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
      expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
        secondReason,
      );
    },
  );

  it("does not retry when turnstileToken was initially non-null", async () => {
    const refreshTurnstileToken = vi.fn(async () => "unused-token");
    const config = makeLobbyConfig({
      turnstileToken: "initial-token",
      refreshTurnstileToken,
    });

    connectWithJoin(config);
    sockets[0].serverClose(CloseCode.Unauthorized, CloseReason.TurnstileFailed);
    await flushMicrotasks();

    expect(refreshTurnstileToken).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.TurnstileFailed,
    );
  });

  it("does not retry after the session has already been admitted via lobby_info", async () => {
    const refreshTurnstileToken = vi.fn(async () => "unused-token");
    const config = makeLobbyConfig({
      turnstileToken: null,
      creatorToken: CREATOR_TOKEN,
      refreshTurnstileToken,
    });

    connectWithJoin(config);
    sockets[0].serverOpen();
    await flushMicrotasks();

    sockets[0].serverSend({
      type: "lobby_info",
      myClientID: "c0000001",
      lobby: {
        gameID: "abcd1234",
        serverTime: 1_700_000_000_000,
      },
    });
    expect(config.creatorToken).toBeUndefined();

    sockets[0].serverClose(
      CloseCode.Unauthorized,
      CloseReason.TurnstilePassRequired,
    );
    await flushMicrotasks();

    expect(refreshTurnstileToken).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not retry when refreshTurnstileToken is omitted", async () => {
    const config = makeLobbyConfig({
      turnstileToken: null,
    });

    connectWithJoin(config);
    sockets[0].serverClose(CloseCode.Unauthorized, CloseReason.TurnstileFailed);
    await flushMicrotasks();

    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.TurnstileFailed,
    );
  });

  it.each(["resolve", "reject"] as const)(
    "aborts refreshTurnstileToken on leaveGame() and ignores late %s",
    async (outcome) => {
      const pending = deferred<string | null>();
      let capturedSignal: AbortSignal | undefined;
      const refreshTurnstileToken = vi.fn((signal: AbortSignal) => {
        capturedSignal = signal;
        return pending.promise;
      });
      const config = makeLobbyConfig({
        turnstileToken: null,
        refreshTurnstileToken,
      });

      const transport = connectWithJoin(config);
      sockets[0].serverClose(
        CloseCode.Unauthorized,
        CloseReason.TurnstilePassRequired,
      );
      expect(capturedSignal?.aborted).toBe(false);

      transport.leaveGame();
      expect(capturedSignal?.aborted).toBe(true);

      if (outcome === "resolve") {
        pending.resolve("late-token");
      } else {
        pending.reject(new Error("late failure"));
      }
      await flushMicrotasks();

      expect(config.turnstileToken).toBeNull();
      expect(sockets).toHaveLength(1);
      expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["rejects", () => Promise.reject(new Error("turnstile exploded"))],
    ["resolves null", () => Promise.resolve(null)],
    ["resolves empty string", () => Promise.resolve("")],
  ])(
    "falls through once to connection refused when refreshTurnstileToken %s",
    async (_label, impl) => {
      const config = makeLobbyConfig({
        turnstileToken: null,
        refreshTurnstileToken: vi.fn(impl),
      });

      connectWithJoin(config);
      sockets[0].serverClose(
        CloseCode.Unauthorized,
        CloseReason.TurnstilePassRequired,
      );
      await flushMicrotasks();

      expect(sockets).toHaveLength(1);
      expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
      expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
        CloseReason.TurnstilePassRequired,
      );
    },
  );

  it("ends quietly without a connection-refused dialog when the fallback challenge is cancelled", async () => {
    const config = makeLobbyConfig({
      turnstileToken: null,
      creatorToken: CREATOR_TOKEN,
      refreshTurnstileToken: vi.fn(() =>
        Promise.reject(new TurnstileError(TURNSTILE_CANCELLED_CODE)),
      ),
    });

    connectWithJoin(config);
    sockets[0].serverOpen();
    await flushMicrotasks();

    sockets[0].serverClose(
      CloseCode.Unauthorized,
      CloseReason.TurnstilePassRequired,
    );
    await flushMicrotasks();

    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
  });
});
