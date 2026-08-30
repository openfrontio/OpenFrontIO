import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";

const modalMocks = vi.hoisted(() => ({
  showInGameAlert: vi.fn<(message: string) => Promise<boolean>>(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: modalMocks.showInGameAlert,
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

describe("Transport 1002 connection refused", () => {
  let mockLocationHref = "";
  let dismissAlert: ((value: boolean) => void) | undefined;

  beforeEach(() => {
    sockets.length = 0;
    mockLocationHref = "http://localhost:9000/w1/game/abcd1234";
    dismissAlert = undefined;
    modalMocks.showInGameAlert.mockReset();
    modalMocks.showInGameAlert.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          dismissAlert = resolve;
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

  it("shows the refused alert once and goes home when Close is clicked", async () => {
    connectTransport();
    expect(sockets).toHaveLength(1);

    sockets[0].serverClose(1002, "Game not found");

    expect(modalMocks.showInGameAlert).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameAlert.mock.calls[0][0]).toContain(
      "Game not found",
    );
    expect(window.location.href).toBe("http://localhost:9000/w1/game/abcd1234");

    dismissAlert?.(true);
    await Promise.resolve();

    expect(window.location.href).toBe("/");
  });

  it("does not reopen the socket after Game not found", () => {
    const transport = connectTransport();
    sockets[0].serverClose(1002, "Game not found");

    transport.reconnect();
    transport.reconnect();

    expect(sockets).toHaveLength(1);
    expect(modalMocks.showInGameAlert).toHaveBeenCalledTimes(1);
  });

  it("still reconnects after an abnormal close", () => {
    connectTransport();

    sockets[0].serverClose(1006, "");

    expect(sockets).toHaveLength(2);
    expect(modalMocks.showInGameAlert).not.toHaveBeenCalled();
  });
});
