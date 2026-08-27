import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerLiveStats } from "../../src/core/Schemas";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { Client } from "../../src/server/Client";
import { ServerEnv } from "../../src/server/ServerEnv";
import {
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

const TURN_MS = 100;

describe("GameServer.handleLiveStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // A game with three distinct-IP players in the lobby.
  function gameWithClients() {
    const game = makeGame();
    const clients = [
      makeClient({
        clientID: "client01",
        ip: "1.1.1.1",
        username: "Alice",
        publicId: "public01",
      }),
      makeClient({
        clientID: "client02",
        ip: "2.2.2.2",
        username: "Bob",
        publicId: "public02",
      }),
      makeClient({
        clientID: "client03",
        ip: "3.3.3.3",
        username: "Carol",
        publicId: "public03",
      }),
    ];
    for (const c of clients) game.joinClient(c);
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
      killedBy: null,
      deathPosition: null,
    },
  ];

  // What a client does every ~10s: send its snapshot of the board.
  const report = (client: Client, turn: number, players: PlayerLiveStats[]) =>
    mockWsOf(client).emit({ type: "live_stats", stats: { turn, players } });

  it("reaches consensus at a strict majority and enriches usernames", async () => {
    const { game, clients } = gameWithClients();
    const players = snapshot(10);

    await report(clients[0], 100, players);
    // 1 of 3 IPs -> not yet.
    expect(game.liveStats()).toBeNull();

    await report(clients[1], 100, players);
    // 2 of 3 IPs -> consensus.
    expect(game.liveStats()).toEqual({
      turn: 100,
      winner: null,
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

  it("reports server-side connection status per player", async () => {
    const { game, clients } = gameWithClients();
    startGame(game);
    // client01 (the only player in the snapshot) went quiet: the turn loop
    // marks them disconnected at the next 5-turn boundary.
    clients[0].lastPing = Date.now() - 31_000;
    vi.advanceTimersByTime(5 * TURN_MS);
    expect(game.isClientDisconnected("client01")).toBe(true);

    const players = snapshot(10);
    await report(clients[0], 100, players);
    await report(clients[1], 100, players);
    expect(game.liveStats()?.players[0].connected).toBe(false);
  });

  it("does not reach consensus when clients disagree", async () => {
    const { game, clients } = gameWithClients();
    await report(clients[0], 100, snapshot(10));
    await report(clients[1], 100, snapshot(20));
    await report(clients[2], 100, snapshot(30));
    expect(game.liveStats()).toBeNull();
  });

  it("ignores a second vote from the same client in a turn", async () => {
    const { game, clients } = gameWithClients();
    await report(clients[0], 100, snapshot(10));
    // Same client trying to back a different snapshot is ignored, so neither
    // candidate can reach a majority from this one client.
    await report(clients[0], 100, snapshot(20));
    await report(clients[1], 100, snapshot(20));
    expect(game.liveStats()).toBeNull();
  });

  it("ignores stats for a turn already settled", async () => {
    const { game, clients } = gameWithClients();
    const players = snapshot(10);
    await report(clients[0], 100, players);
    await report(clients[1], 100, players);
    expect(game.liveStats()?.turn).toBe(100);

    // Late/old turns must not overwrite the latest snapshot.
    await report(clients[0], 50, snapshot(99));
    await report(clients[1], 50, snapshot(99));
    expect(game.liveStats()?.turn).toBe(100);
  });

  it("advances to a newer turn once it reaches consensus", async () => {
    const { game, clients } = gameWithClients();
    await report(clients[0], 100, snapshot(10));
    await report(clients[1], 100, snapshot(10));
    expect(game.liveStats()?.turn).toBe(100);

    await report(clients[0], 200, snapshot(42));
    await report(clients[1], 200, snapshot(42));
    expect(game.liveStats()).toEqual({
      turn: 200,
      winner: null,
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

  it("ignores out-of-sync clients", async () => {
    const { game, clients } = gameWithClients();
    startGame(game);
    // client01 reports a different hash for turn 0 than the other two; the
    // check ten turns later marks them desynced.
    await mockWsOf(clients[0]).emit({ type: "hash", hash: 1, turnNumber: 0 });
    await mockWsOf(clients[1]).emit({ type: "hash", hash: 2, turnNumber: 0 });
    await mockWsOf(clients[2]).emit({ type: "hash", hash: 2, turnNumber: 0 });
    vi.advanceTimersByTime(10 * TURN_MS);
    expect(game.numDesyncedClients()).toBe(1);

    await report(clients[0], 100, snapshot(10));
    await report(clients[1], 100, snapshot(10));
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
