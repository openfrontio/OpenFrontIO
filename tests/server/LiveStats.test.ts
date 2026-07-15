import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { PlayerLiveStats } from "../../src/core/Schemas";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { GameServer } from "../../src/server/GameServer";
import { ServerEnv } from "../../src/server/ServerEnv";

describe("GameServer.handleLiveStats", () => {
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

  function makeClient(clientID: string, ip: string, username: string) {
    return {
      clientID,
      ip,
      persistentID: `pid-${clientID}`,
      username,
      publicId: clientID.replace("client", "public"), // 8-char ID, e.g. public01
    } as any;
  }

  // A GameServer with three distinct-IP active clients wired up.
  function gameWithClients() {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    const clients = [
      makeClient("client01", "1.1.1.1", "Alice"),
      makeClient("client02", "2.2.2.2", "Bob"),
      makeClient("client03", "3.3.3.3", "Carol"),
    ];
    (game as any).activeClients = clients;
    const allClients = new Map<string, unknown>();
    const disconnected = new Map<string, boolean>();
    for (const c of clients) {
      allClients.set(c.clientID, c);
      disconnected.set(c.clientID, false); // all connected
    }
    (game as any).allClients = allClients;
    (game as any).clientsDisconnectedStatus = disconnected;
    return { game, clients };
  }

  const snapshot = (tilesOwned: number): PlayerLiveStats[] => [
    {
      clientID: "client01",
      tilesOwned,
      troops: 5,
      gold: "100",
      isAlive: true,
      team: null,
    },
  ];

  const report = (
    game: GameServer,
    client: any,
    turn: number,
    players: PlayerLiveStats[],
  ) =>
    (game as any).handleLiveStats(client, {
      type: "live_stats",
      stats: { turn, players },
    });

  it("reaches consensus at a strict majority and enriches usernames", () => {
    const { game, clients } = gameWithClients();
    const players = snapshot(10);

    report(game, clients[0], 100, players);
    // 1 of 3 IPs -> not yet.
    expect(game.liveStats()).toBeNull();

    report(game, clients[1], 100, players);
    // 2 of 3 IPs -> consensus.
    expect(game.liveStats()).toEqual({
      turn: 100,
      players: [
        {
          ...players[0],
          username: "Alice",
          publicID: "public01",
          connected: true,
        },
      ],
    });
  });

  it("reports server-side connection status per player", () => {
    const { game, clients } = gameWithClients();
    // client01 (the only player in the snapshot) has dropped.
    (game as any).clientsDisconnectedStatus.set("client01", true);
    const players = snapshot(10);
    report(game, clients[0], 100, players);
    report(game, clients[1], 100, players);
    expect(game.liveStats()?.players[0].connected).toBe(false);
  });

  it("does not reach consensus when clients disagree", () => {
    const { game, clients } = gameWithClients();
    report(game, clients[0], 100, snapshot(10));
    report(game, clients[1], 100, snapshot(20));
    report(game, clients[2], 100, snapshot(30));
    expect(game.liveStats()).toBeNull();
  });

  it("ignores a second vote from the same client in a turn", () => {
    const { game, clients } = gameWithClients();
    report(game, clients[0], 100, snapshot(10));
    // Same client trying to back a different snapshot is ignored, so neither
    // candidate can reach a majority from this one client.
    report(game, clients[0], 100, snapshot(20));
    report(game, clients[1], 100, snapshot(20));
    expect(game.liveStats()).toBeNull();
  });

  it("ignores stats for a turn already settled", () => {
    const { game, clients } = gameWithClients();
    const players = snapshot(10);
    report(game, clients[0], 100, players);
    report(game, clients[1], 100, players);
    expect(game.liveStats()?.turn).toBe(100);

    // Late/old turns must not overwrite the latest snapshot.
    report(game, clients[0], 50, snapshot(99));
    report(game, clients[1], 50, snapshot(99));
    expect(game.liveStats()?.turn).toBe(100);
  });

  it("advances to a newer turn once it reaches consensus", () => {
    const { game, clients } = gameWithClients();
    report(game, clients[0], 100, snapshot(10));
    report(game, clients[1], 100, snapshot(10));
    expect(game.liveStats()?.turn).toBe(100);

    report(game, clients[0], 200, snapshot(42));
    report(game, clients[1], 200, snapshot(42));
    expect(game.liveStats()).toEqual({
      turn: 200,
      players: [
        {
          ...snapshot(42)[0],
          username: "Alice",
          publicID: "public01",
          connected: true,
        },
      ],
    });
  });

  it("ignores out-of-sync clients", () => {
    const { game, clients } = gameWithClients();
    (game as any).outOfSyncClients = new Set(["client01"]);
    report(game, clients[0], 100, snapshot(10));
    report(game, clients[1], 100, snapshot(10));
    // Only client02's vote counted (1 of 3) -> no consensus.
    expect(game.liveStats()).toBeNull();
  });
});

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

// Capture the GET handler registered for the stats route, bypassing the
// requireAdminBotKey middleware (tested separately).
function captureStatsHandler(gm: unknown) {
  const routes: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    post() {},
    get(path: string, ...handlers: ((req: any, res: any) => void)[]) {
      routes[path] = handlers[handlers.length - 1];
    },
  };
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerAdminBotRoutes({ app, gm: gm as any, workerId: 0, log });
  return routes["/api/adminbot/game/:id/stats"];
}

describe("admin bot stats endpoint", () => {
  beforeEach(() => {
    vi.spyOn(ServerEnv, "workerIndex").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the game's live stats", () => {
    const liveStats = {
      turn: 100,
      players: [
        {
          clientID: "client01",
          tilesOwned: 10,
          troops: 5,
          gold: "100",
          isAlive: true,
          team: null,
          username: "Alice",
          publicID: "public01",
          connected: true,
        },
      ],
    };
    const gm = { game: () => ({ liveStats: () => liveStats }) };
    const handler = captureStatsHandler(gm);
    const res = mockRes();
    handler({ params: { id: "abcdABCD" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.gameID).toBe("abcdABCD");
    expect(res.body.liveStats).toEqual(liveStats);
  });

  it("404s when the game is not found", () => {
    const gm = { game: () => null };
    const handler = captureStatsHandler(gm);
    const res = mockRes();
    handler({ params: { id: "abcdABCD" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("400s on an invalid game id", () => {
    const gm = { game: () => null };
    const handler = captureStatsHandler(gm);
    const res = mockRes();
    handler({ params: { id: "bad" } }, res);
    expect(res.statusCode).toBe(400);
  });
});
