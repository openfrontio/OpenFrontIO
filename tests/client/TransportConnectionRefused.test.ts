import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { CloseCode, CloseReason } from "../../src/core/CloseCodes";

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

// NoServerError comes from the real module: Transport narrows on it with
// `instanceof`, so a stand-in class here would make that check silently
// false and the test would prove the opposite of what it claims.
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
    },
  };
});

import { ClientEnv, NoServerError } from "../../src/client/ClientEnv";
import { Transport } from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
  }

  send() {}

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  serverClose(code: number, reason: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

const sockets: FakeWebSocket[] = [];

function lobbyConfig(): LobbyConfig {
  return {
    cosmetics: {},
    playerName: "tester",
    playerClanTag: null,
    playerRole: null,
    gameID: "abcd1234",
    turnstileToken: null,
  };
}

describe("Transport terminal connection refused", () => {
  let mockLocationHref = "";
  let dismissDialog: ((value: boolean) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    mockLocationHref = "http://localhost:9000/w1/game/abcd1234";
    dismissDialog = undefined;
    modalMocks.showInGameConfirm.mockReset();
    modalMocks.showInGameConfirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          dismissDialog = resolve;
        }),
    );

    Object.defineProperty(window, "location", {
      value: {
        get href() {
          return mockLocationHref;
        },
        set href(value: string) {
          mockLocationHref = value;
        },
        // Cross-host redirects carry the query string along (?spectate).
        search: "",
      },
      writable: true,
      configurable: true,
    });

    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function connectTransport() {
    const transport = new Transport(lobbyConfig(), new EventBus());
    transport.connect(
      () => undefined,
      () => undefined,
    );
    return transport;
  }

  it("shows the refused dialog once and goes home when Return to menu is clicked", async () => {
    connectTransport();
    expect(sockets).toHaveLength(1);

    sockets[0].serverClose(CloseCode.GameNotFound, CloseReason.GameNotFound);

    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.GameNotFound,
    );
    expect(modalMocks.showInGameConfirm.mock.calls[0][1]).toMatchObject({
      confirmText: "win_modal.exit",
      cancelText: "common.close",
    });
    expect(window.location.href).toBe("http://localhost:9000/w1/game/abcd1234");

    dismissDialog?.(true);
    await Promise.resolve();

    expect(window.location.href).toBe("/");
  });

  it("stays on the game page when Close is clicked", async () => {
    connectTransport();
    sockets[0].serverClose(CloseCode.GameNotFound, CloseReason.GameNotFound);

    dismissDialog?.(false);
    await Promise.resolve();

    expect(window.location.href).toBe("http://localhost:9000/w1/game/abcd1234");
    expect(sockets).toHaveLength(1);
  });

  it("latches silently after a normal close", () => {
    // Game over or a kick: the server has said its piece through the game
    // messages. No dialog, and nothing the watchdog asks for reopens it.
    const transport = connectTransport();
    sockets[0].serverClose(CloseCode.Normal, CloseReason.GameEnded);

    transport.reconnect();
    transport.reconnect();

    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
  });

  it("falls back to a generic reason the server did not choose", () => {
    connectTransport();
    sockets[0].serverClose(4999, "");

    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.Unknown,
    );
  });

  // Multi-server v2: a static page whose list never loaded knows no worker
  // count, so an id it cannot route has no socket to dial. That is a
  // connection that cannot be made, not a bug -- it must land where a refused
  // one does, not escape the join as an unhandled exception.
  it("shows the terminal dialog when no server is known, and dials nothing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ClientEnv.gameWorkerPath).mockImplementationOnce(() => {
      throw new NoServerError("no worker count: no server list, none injected");
    });

    const transport = connectTransport();

    expect(sockets).toHaveLength(0);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.Unknown,
    );

    // And it is terminal: the watchdog cannot reopen it, and no timer does.
    transport.reconnect();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(0);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("does not reopen the socket after Game not found", () => {
    const transport = connectTransport();
    sockets[0].serverClose(CloseCode.GameNotFound, CloseReason.GameNotFound);

    transport.reconnect();
    transport.reconnect();

    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1006, ""],
    [CloseCode.InternalError, CloseReason.AccountLookupFailed],
    [CloseCode.InternalError, CloseReason.InvalidToken],
  ])("still reconnects after a retryable close: %i %s", (code, reason) => {
    connectTransport();

    sockets[0].serverClose(code, reason);
    vi.advanceTimersByTime(0);

    expect(sockets).toHaveLength(2);
    expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
  });

  // WrongWorker means this bundle routed with a stale worker count: one full
  // navigation to the game's own host re-fetches shell + cluster map. The
  // sessionStorage latch keeps a still-wrong fresh map from looping — the
  // second refusal falls through to the regular dialog.
  it("navigates to the game's host on a wrong-worker close, once", () => {
    sessionStorage.clear();
    connectTransport();
    sockets[0].serverClose(CloseCode.WrongWorker, CloseReason.WrongWorker);

    expect(window.location.href).toBe("http://game.test/game/abcd1234");
    expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
  });

  it("shows the dialog instead of looping on a second wrong-worker close", () => {
    sessionStorage.clear();
    sessionStorage.setItem("wrong-worker-redirect:abcd1234", "1");
    connectTransport();
    sockets[0].serverClose(CloseCode.WrongWorker, CloseReason.WrongWorker);

    expect(window.location.href).toBe("http://localhost:9000/w1/game/abcd1234");
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.WrongWorker,
    );
  });
});
