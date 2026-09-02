import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, CloseReason } from "../../src/core/CloseCodes";
import { EventBus } from "../../src/core/EventBus";

const showInGameAlert = vi.fn(() => Promise.resolve());
const showInGameConfirm = vi.fn(() => Promise.resolve(false));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    serverWsBase: () => "ws://test.invalid",
    workerPath: (gameID: string) => `w0/${gameID}`,
  },
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: (...args: unknown[]) => showInGameAlert(...(args as [])),
  showInGameConfirm: (...args: unknown[]) => showInGameConfirm(...(args as [])),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
  binaryType = "";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  close = vi.fn();
  send = vi.fn();
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
}

const { Transport } = await import("../../src/client/Transport");

function newTransport() {
  return new Transport(
    {
      cosmetics: {},
      playerName: "tester",
      playerClanTag: null,
      playerRole: null,
      gameID: "game1",
      turnstileToken: null,
    } as never,
    new EventBus(),
  );
}

describe("Transport close handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    showInGameAlert.mockClear();
    showInGameConfirm.mockClear();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function connectAndClose(code: number, reason: string) {
    const transport = newTransport();
    transport.connect(
      () => {},
      () => {},
    );
    FakeWebSocket.last.onclose?.({ code, reason });
    vi.advanceTimersByTime(0);
    return transport;
  }

  it("does not reconnect after a normal close, and stays silent", () => {
    connectAndClose(CloseCode.Normal, CloseReason.GameEnded);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(showInGameConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ["a full lobby", CloseCode.LobbyFull, CloseReason.LobbyFull],
    ["a ban", CloseCode.Banned, CloseReason.Banned],
    [
      "a rejected bot check",
      CloseCode.Unauthorized,
      CloseReason.TurnstileFailed,
    ],
    ["a missing game", CloseCode.GameNotFound, CloseReason.GameNotFound],
  ])("tells the player and gives up on %s", (_label, code, reason) => {
    connectAndClose(code, reason);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(showInGameConfirm).toHaveBeenCalledOnce();
  });

  it.each([
    ["a server fault", CloseCode.InternalError],
    ["a protocol error", CloseCode.ProtocolError],
    ["a retry-later close", CloseCode.TryAgainLater],
    ["an abrupt drop with no close frame", 1006],
  ])("reconnects immediately after %s", (_label, code) => {
    connectAndClose(code, "");
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(showInGameConfirm).not.toHaveBeenCalled();
  });

  it("waits a fixed delay between every retry after the first", () => {
    connectAndClose(CloseCode.ProtocolError, "");
    expect(FakeWebSocket.instances).toHaveLength(2);

    for (let i = 0; i < 5; i++) {
      const before = FakeWebSocket.instances.length;
      FakeWebSocket.last.onclose?.({
        code: CloseCode.ProtocolError,
        reason: "",
      });
      vi.advanceTimersByTime(4999);
      expect(FakeWebSocket.instances).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
    }
  });

  it("gives up and tells the player after 10 attempts", () => {
    connectAndClose(CloseCode.ProtocolError, "");
    for (let i = 1; i < 10; i++) {
      FakeWebSocket.last.onclose?.({
        code: CloseCode.ProtocolError,
        reason: "",
      });
      vi.advanceTimersByTime(5000);
    }
    expect(FakeWebSocket.instances).toHaveLength(11);
    expect(showInGameAlert).not.toHaveBeenCalled();

    FakeWebSocket.last.onclose?.({ code: CloseCode.ProtocolError, reason: "" });
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(11);
    expect(showInGameAlert).toHaveBeenCalledOnce();
  });

  it("restarts the attempt count once a connection succeeds", () => {
    connectAndClose(CloseCode.ProtocolError, "");
    FakeWebSocket.last.onclose?.({ code: CloseCode.ProtocolError, reason: "" });
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.last.onopen?.();
    FakeWebSocket.last.onclose?.({ code: CloseCode.ProtocolError, reason: "" });
    vi.advanceTimersByTime(0);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("drops a pending reconnect when the player leaves the game", () => {
    const transport = connectAndClose(CloseCode.ProtocolError, "");
    FakeWebSocket.last.onclose?.({ code: CloseCode.ProtocolError, reason: "" });
    transport.leaveGame();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
