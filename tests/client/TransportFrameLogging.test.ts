import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/EventBus";
import type { ServerMessage } from "../../src/core/Schemas";
import { encodeServerMessage } from "../../src/core/ZbinWire";

// OPE-423. Transport's onmessage catch used to log the raw frame. That catch
// wraps the downstream handler as well as the decode, so any exception thrown
// while handling a message dumped the bytes that produced it — and a lobby_info
// or start frame carries the game's group token in the clear. The desktop shell
// persists console.error, so those bytes outlive the session.

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
vi.mock("../../src/client/LocalServer", () => ({ LocalServer: class {} }));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: async () => false,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  homeHref: () => "/",
}));

import type { LobbyConfig } from "../../src/client/ClientGameRunner";
import { Transport } from "../../src/client/Transport";

const TOKEN = "Zm9vYmFyYmF6cXV4";

// Just enough socket for Transport to attach its handlers and be fed a frame.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.last = this;
  }
  send() {}
  close() {
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

function lobbyInfoFrame(): ServerMessage {
  return {
    type: "lobby_info",
    lobby: { gameID: "abcd1234", serverTime: 1_700_000_000_000 },
    myClientID: "cl001234",
    groupToken: TOKEN,
  };
}

describe("Transport frame-handling errors", () => {
  let transport: Transport;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    FakeWebSocket.last = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    transport = new Transport(
      {
        gameID: "abcd1234",
        playerName: "tester",
        spectator: false,
      } as unknown as LobbyConfig,
      new EventBus(),
    );
  });

  afterEach(() => {
    transport.leaveGame();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The downstream handler throwing is an ordinary application bug, not a
  // corrupt frame — and it is the common way into this catch.
  function connectAndFailOn(msg: ServerMessage) {
    transport.connect(
      () => {},
      () => {
        throw new Error("downstream handler blew up");
      },
    );
    FakeWebSocket.last!.serverOpen();
    FakeWebSocket.last!.serverSend(msg);
  }

  it("does not log the frame buffer", () => {
    connectAndFailOn(lobbyInfoFrame());

    expect(errorSpy).toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(arg instanceof ArrayBuffer).toBe(false);
        expect(ArrayBuffer.isView(arg)).toBe(false);
      }
    }
  });

  it("does not leak the group token the frame carried", () => {
    connectAndFailOn(lobbyInfoFrame());

    for (const call of errorSpy.mock.calls) {
      // Covers the Error argument too, whose message and stack are strings.
      const rendered = call
        .map((a: unknown) =>
          a instanceof Error ? `${a.message}${a.stack}` : String(a),
        )
        .join(" ");
      expect(rendered).not.toContain(TOKEN);
    }
  });

  // Something has to be diagnosable, or the fix is just deleting evidence.
  it("still reports the error and the frame size", () => {
    connectAndFailOn(lobbyInfoFrame());

    const rendered = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(rendered).toContain("Error in onmessage handler");
    expect(rendered).toMatch(/frame: \d+ bytes/);
    expect(rendered).toContain("downstream handler blew up");
  });

  // console.* reads argument one as a format string (%s, %d, %o). Anything
  // derived from the frame must therefore ride in a LATER argument, or a
  // crafted frame could steer the formatting of the log line.
  it("keeps frame-derived text out of the format-string argument", () => {
    connectAndFailOn(lobbyInfoFrame());

    for (const call of errorSpy.mock.calls) {
      expect(typeof call[0]).toBe("string");
      expect(call[0]).toBe("Error in onmessage handler:");
    }
  });
});
