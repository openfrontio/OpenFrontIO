import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
import { ServerEnv } from "../../src/server/ServerEnv";
import {
  makeClient as harnessClient,
  mockLogger,
  mockWsOf,
} from "../util/GameServerHarness";
import { testGameConfig } from "../util/Wire";

// The roster endpoint is the ONE place a per-game clientID can be tied back to an
// account: the public record is PII-stripped, so without it a host sees that 96
// people played and can identify none of them. Which makes the gate the point of
// the feature — it must never read a lobby the bot did not create.
function routes(game: unknown) {
  const table: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    get(path: string, ...h: ((req: any, res: any) => void)[]) {
      table[path] = h[h.length - 1];
    },
    post(path: string, ...h: ((req: any, res: any) => void)[]) {
      table[path] = h[h.length - 1];
    },
  };
  const gm: any = { game: () => game, createGame: () => game };
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerAdminBotRoutes({ app, gm, workerId: 0, log });
  return table;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const ROSTER = [
  { clientID: "c1", publicId: "pub1", username: "ana" },
  { clientID: "c2", publicId: undefined, username: "anon" },
];

beforeEach(() => {
  vi.spyOn(ServerEnv, "workerIndex").mockReturnValue(0);
});

describe("GET /api/adminbot/game/:id/roster", () => {
  it("returns the clientID → publicId mapping for a bot-hosted lobby", () => {
    const table = routes({ roster: () => ROSTER });
    const res = mockRes();
    table["/api/adminbot/game/:id/roster"]({ params: { id: "aaaaaaaa" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.players).toEqual(ROSTER);
  });

  it("404s an unknown game rather than leaking whether it exists elsewhere", () => {
    const table = routes(null);
    const res = mockRes();
    table["/api/adminbot/game/:id/roster"]({ params: { id: "aaaaaaaa" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed game id", () => {
    const table = routes({ roster: () => ROSTER });
    const res = mockRes();
    table["/api/adminbot/game/:id/roster"]({ params: { id: "nope!" } }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("GameServer.roster() — the real projection", () => {
  // The route tests above stub roster(); this one drives the real thing on a
  // real GameServer, because the projection's value is its SEMANTICS: it reads
  // allClients, so a player who joined and then disconnected still appears in
  // the mapping the host has to reconcile against the game record.
  function makeClient(id: string, publicId?: string): Client {
    return harnessClient({
      clientID: id,
      persistentID: `${id}-pid`,
      username: id,
      publicId,
    });
  }
  const logger = mockLogger();

  it("maps every joiner — including one who already disconnected", async () => {
    vi.useFakeTimers();
    try {
      const game = new GameServer(
        "g1",
        logger,
        Date.now(),
        testGameConfig({ gameType: GameType.Private }),
      );
      const stays = makeClient("c1", "pub1");
      const leaves = makeClient("c2", "pub2");
      const anon = makeClient("c3"); // no account — publicId stays undefined
      expect(game.joinClient(stays)).toBe("joined");
      expect(game.joinClient(leaves)).toBe("joined");
      expect(game.joinClient(anon)).toBe("joined");

      await mockWsOf(leaves).trigger("close");

      const players = game.roster();
      expect(players).toEqual([
        { clientID: "c1", publicId: "pub1", username: "c1" },
        { clientID: "c2", publicId: "pub2", username: "c2" },
        { clientID: "c3", publicId: undefined, username: "c3" },
      ]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
