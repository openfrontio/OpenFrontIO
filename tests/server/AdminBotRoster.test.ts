import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { ServerEnv } from "../../src/server/ServerEnv";

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
