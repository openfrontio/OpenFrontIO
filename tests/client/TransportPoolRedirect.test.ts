import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { CloseReason } from "../../src/core/CloseCodes";

const modalMocks = vi.hoisted(() => ({
  showInGameConfirm: vi.fn<(message: string) => Promise<boolean>>(),
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

vi.mock("src/client/ClientEnv", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/ClientEnv")>();
  return {
    NoServerError: actual.NoServerError,
    ClientEnv: {
      gameWorkerPath: vi.fn(() => "w0"),
      gameWsBase: vi.fn(() => "ws://game.test"),
      gameHttpBase: vi.fn(() => "http://game.test"),
      gamePath: vi.fn((gameID: string) => `/w0/game/${gameID}`),
    },
  };
});

import { Transport } from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";
import { encodeServerMessage } from "../../src/core/ZbinWire";

const ENTRY = "aaaa1111";
const SIBLING = "bbbb2222";
const HOME = "http://localhost:9000/w0/game/aaaa1111";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(_url: string | URL) {
    sockets.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
  }

  // Deliver a server frame the way the real socket does: a zbin ArrayBuffer.
  deliver(msg: Parameters<typeof encodeServerMessage>[0]) {
    const bytes = encodeServerMessage(msg, undefined);
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
}

const sockets: FakeWebSocket[] = [];

function lobbyConfig(gameID: string): LobbyConfig {
  return {
    cosmetics: {},
    playerName: "tester",
    playerClanTag: null,
    playerRole: null,
    gameID,
    turnstileToken: null,
  };
}

// Connect a client to `gameID` and hand back the socket the server talks on.
function connect(gameID: string): FakeWebSocket {
  const transport = new Transport(lobbyConfig(gameID), new EventBus());
  transport.connect(
    () => undefined,
    () => undefined,
  );
  return sockets[sockets.length - 1];
}

const latch = (gameID: string) =>
  sessionStorage.getItem(`pool-redirect:${gameID}`);

describe("Transport pool redirect", () => {
  let mockLocationHref = "";

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    sessionStorage.clear();
    mockLocationHref = HOME;
    modalMocks.showInGameConfirm.mockReset();
    modalMocks.showInGameConfirm.mockResolvedValue(false);

    Object.defineProperty(window, "location", {
      value: {
        get href() {
          return mockLocationHref;
        },
        set href(value: string) {
          mockLocationHref = value;
        },
        search: "?ref=somewhere",
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

  it("navigates to the assigned sibling, without the search string", () => {
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });

    expect(window.location.href).toBe(`/w0/game/${SIBLING}`);
    expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
  });

  it("clears the entry lobby's latch once the sibling takes us", () => {
    // The latch is keyed by the lobby that redirected, but only the lobby we
    // land on can see that the redirect worked — so the source id has to
    // survive the navigation.
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });
    expect(latch(ENTRY)).not.toBeNull();

    connect(SIBLING).deliver({
      type: "lobby_info",
      lobby: { gameID: SIBLING, serverTime: 1_700_000_000_000 },
      myClientID: "cl001234",
    });

    expect(latch(ENTRY)).toBeNull();
    expect(sessionStorage.getItem("pool-redirect-from")).toBeNull();
  });

  it("keeps the latch when the sibling refuses us", () => {
    // A full sibling sends an error frame right before it closes. That is not
    // an admission, so going back to the entry shows the refusal instead of
    // silently sending the player to the same full sibling again.
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });
    connect(SIBLING).deliver({ type: "error", error: "full-lobby" });
    expect(latch(ENTRY)).not.toBeNull();

    mockLocationHref = HOME;
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });

    expect(window.location.href).toBe(HOME);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.PoolRedirect,
    );
  });

  it("routes again on a later visit once a sibling admitted us", () => {
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });
    connect(SIBLING).deliver({
      type: "lobby_info",
      lobby: { gameID: SIBLING, serverTime: 1_700_000_000_000 },
      myClientID: "cl001234",
    });

    mockLocationHref = HOME;
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });

    expect(window.location.href).toBe(`/w0/game/${SIBLING}`);
    expect(modalMocks.showInGameConfirm).not.toHaveBeenCalled();
  });

  it("refuses a second redirect from the same lobby instead of bouncing", () => {
    // Members configured with pools that disagree. The first redirect is
    // never answered by a lobby, so the latch is still armed.
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });
    mockLocationHref = HOME;
    connect(ENTRY).deliver({ type: "redirect", gameID: SIBLING });

    expect(window.location.href).toBe(HOME);
    expect(modalMocks.showInGameConfirm).toHaveBeenCalledTimes(1);
    expect(modalMocks.showInGameConfirm.mock.calls[0][0]).toContain(
      CloseReason.PoolRedirect,
    );
  });
});
