import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";

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
}));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    workerPath: vi.fn(() => "w0"),
    serverWsBase: vi.fn(() => "ws://game.test"),
  },
}));

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
      },
      writable: true,
      configurable: true,
    });

    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
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

    sockets[0].serverClose(1003, "Game not found");

    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      "Game not found",
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
    sockets[0].serverClose(1003, "Game not found");

    dismissDialog?.(false);
    await Promise.resolve();

    expect(window.location.href).toBe("http://localhost:9000/w1/game/abcd1234");
    expect(sockets).toHaveLength(1);
  });

  it("does not reopen the socket after Game not found", () => {
    const transport = connectTransport();
    sockets[0].serverClose(1003, "Game not found");

    transport.reconnect();
    transport.reconnect();

    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1006, ""],
    [1002, "WS_ERR_UNEXPECTED_RSV_1"],
    [1002, "Unauthorized: user me fetch failed"],
    [1002, "Unauthorized: invalid token"],
  ])("still reconnects after a retryable close: %i %s", (code, reason) => {
    connectTransport();

    sockets[0].serverClose(code, reason);

    expect(sockets).toHaveLength(2);
    expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
  });
});
