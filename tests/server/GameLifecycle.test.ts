import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/Schemas", async () => {
  const actual = (await vi.importActual("../../src/core/Schemas")) as any;
  return {
    ...actual,
    GameStartInfoSchema: {
      safeParse: (data: any) => ({ success: true, data: data }),
    },
    ServerPrestartMessageSchema: {
      safeParse: (data: any) => ({ success: true, data: data }),
    },
  };
});

import { GameType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";

describe("GameLifecycle", () => {
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
  });

  it("should not start turn interval if game has ended", async () => {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);

    // Call end() first - this should set _hasEnded
    await game.end();

    // Now call start() - this should be a no-op due to our fix
    game.start();

    // Check if the interval ID is set (it shouldn't be)
    expect((game as any).endTurnIntervalID).toBeUndefined();

    // Check if _hasStarted remained false (or at least no interval was created)
    expect(game.hasStarted()).toBe(false);
  });

  it("should clear turn interval and set _hasEnded on end()", async () => {
    // We need to initialize the game such that start() can succeed
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
      gameMap: "plains",
      gameMapSize: 100,
    } as any);

    // Manually trigger prestart to fulfill some internal checks if necessary
    game.prestart();

    // start() should create the interval
    game.start();
    expect((game as any).endTurnIntervalID).toBeDefined();

    // end() should clear it
    await game.end();
    expect((game as any).endTurnIntervalID).toBeUndefined();
    expect((game as any)._hasEnded).toBe(true);
  });

  it("should be resilient to multiple end() calls", async () => {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);

    await game.end();
    expect((game as any)._hasEnded).toBe(true);

    // Should not throw or crash
    await expect(game.end()).resolves.toBeUndefined();
    expect((game as any)._hasEnded).toBe(true);
  });
});

describe("GameServer.rejoinClient — clanTag identityUpdate", () => {
  let mockLogger: any;
  const mkWs = (): any => ({
    readyState: 1, // OPEN
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    removeAllListeners: vi.fn(),
  });

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const seedClient = (game: GameServer, clanTag: string | null) => {
    const ws = mkWs();
    const client = new Client(
      "cid-1",
      "pid-1",
      null,
      null,
      undefined,
      "127.0.0.1",
      "tester",
      clanTag,
      ws,
      undefined,
      undefined,
      [],
    );
    // Seed internals as if the client had joined normally.
    (game as any).activeClients.push(client);
    (game as any).allClients.set(client.clientID, client);
    (game as any).persistentIdToClientId.set(
      client.persistentID,
      client.clientID,
    );
    (game as any).websockets.add(ws);
    return client;
  };

  it("preserves clanTag on reconnect when identityUpdate omits it", () => {
    const game = new GameServer("g-1", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    const client = seedClient(game, "ABC");

    const newWs = mkWs();
    const ok = game.rejoinClient(newWs as any, "pid-1", 0, {
      username: "renamed",
    });

    expect(ok).toBe(true);
    expect(client.clanTag).toBe("ABC");
    expect(client.username).toBe("renamed");
  });

  it("clears clanTag on reconnect when identityUpdate passes null", () => {
    const game = new GameServer("g-2", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    const client = seedClient(game, "ABC");

    game.rejoinClient(mkWs() as any, "pid-1", 0, {
      username: "tester",
      clanTag: null,
    });

    expect(client.clanTag).toBeNull();
  });

  it("updates clanTag on reconnect when identityUpdate passes a new tag", () => {
    const game = new GameServer("g-3", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    const client = seedClient(game, "ABC");

    game.rejoinClient(mkWs() as any, "pid-1", 0, {
      username: "tester",
      clanTag: "XYZ",
    });

    expect(client.clanTag).toBe("XYZ");
  });

  it("does not change identity if the game has already started", () => {
    const game = new GameServer("g-4", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    const client = seedClient(game, "ABC");
    (game as any)._hasStarted = true;

    game.rejoinClient(mkWs() as any, "pid-1", 0, {
      username: "renamed",
      clanTag: "XYZ",
    });

    expect(client.clanTag).toBe("ABC");
    expect(client.username).toBe("tester");
  });
});
