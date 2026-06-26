import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/Schemas", async () => {
  const actual = (await vi.importActual("../../src/core/Schemas")) as any;
  return {
    ...actual,
    GameStartInfoSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
    ServerPrestartMessageSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
    ClientMessageSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
  };
});

import { GameType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

// Stateful mock that records listeners so a test can fire the "close" event,
// exercising GameServer's real ws.on("close") handler.
function makeMockWs() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] ??= []).push(cb);
    },
    removeAllListeners() {
      for (const k of Object.keys(listeners)) delete listeners[k];
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    },
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  };
}

function makeClient(
  clientID: string,
  persistentID: string,
  ws: ReturnType<typeof makeMockWs>,
): Client {
  return new Client(
    clientID,
    persistentID,
    null,
    null,
    undefined,
    "127.0.0.1",
    "TestUser",
    null,
    ws as any,
    undefined,
    undefined,
    [],
  );
}

describe("GameServer - wasAdmitted (Turnstile re-admission)", () => {
  let mockLogger: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function makeGame() {
    return new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
  }

  it("reports unknown players as not admitted", () => {
    const game = makeGame();
    expect(game.wasAdmitted("nobody")).toBe(false);
  });

  it("marks a player admitted after a successful join", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient("c1", "p1", makeMockWs()))).toBe(
      "joined",
    );
    expect(game.wasAdmitted("p1")).toBe(true);
  });

  // Core regression: a lobby-phase disconnect clears the reconnect mapping (to
  // free the slot), but admission must survive so the reconnect skips the
  // single-use Turnstile re-check instead of failing on the spent token.
  it("keeps a player admitted after a lobby-phase disconnect clears their reconnect mapping", () => {
    const game = makeGame();
    const ws = makeMockWs();
    expect(game.joinClient(makeClient("c1", "p1", ws))).toBe("joined");
    expect(game.getClientIdForPersistentId("p1")).toBe("c1");
    expect(game.wasAdmitted("p1")).toBe(true);

    // Socket drops before the game starts -> the close handler clears the
    // persistentID->clientID mapping.
    ws.emit("close");

    expect(game.getClientIdForPersistentId("p1")).toBeNull();
    expect(game.wasAdmitted("p1")).toBe(true);
  });

  it("does not treat a kicked player as admitted (kick still forces the gate)", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient("c1", "p1", makeMockWs()))).toBe(
      "joined",
    );
    expect(game.wasAdmitted("p1")).toBe(true);

    game.kickClient("c1");
    expect(game.wasAdmitted("p1")).toBe(false);
  });
});
