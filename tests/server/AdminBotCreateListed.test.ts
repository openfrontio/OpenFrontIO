import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { ServerEnv } from "../../src/server/ServerEnv";

// Capture the create_game handler off a fake Express app. requireAdminBotKey is
// the preceding middleware (tested separately), so this exercises the listing
// behaviour: the pre-create guards, and that `listed` never reaches GameConfig.
function captureCreateHandler(game: { setListed: (v: boolean) => void }) {
  const routes: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    post(path: string, ...handlers: ((req: any, res: any) => void)[]) {
      routes[path] = handlers[handlers.length - 1];
    },
    get() {},
  };
  const created: { config?: Record<string, unknown> } = {};
  const gm: any = {
    createGame(_id: string, config: Record<string, unknown>) {
      created.config = config;
      return { ...game, gameInfo: () => ({ gameID: "x" }) };
    },
  };
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerAdminBotRoutes({ app, gm, workerId: 0, log });
  return { handler: routes["/api/adminbot/create_game"], created };
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

const BASE = { gameMap: "World", gameMode: "Free For All" };

beforeEach(() => {
  // Minting an id derives the worker count from the environment; the other
  // admin-bot route tests stub ServerEnv the same way.
  vi.spyOn(ServerEnv, "generateGameIdForWorker").mockReturnValue("aaaaaaaa");
  vi.spyOn(ServerEnv, "workerPath").mockReturnValue("w0");
});

describe("admin bot create_game public listing", () => {
  it("lists the lobby when asked", () => {
    const setListed = vi.fn();
    const { handler } = captureCreateHandler({ setListed });
    const res = mockRes();
    handler({ body: { ...BASE, listed: true } }, res);
    expect(res.statusCode).toBe(200);
    expect(setListed).toHaveBeenCalledWith(true);
  });

  it("does not list by default", () => {
    const setListed = vi.fn();
    const { handler } = captureCreateHandler({ setListed });
    handler({ body: BASE }, mockRes());
    expect(setListed).not.toHaveBeenCalled();
  });

  it("never leaks `listed` into GameConfig", () => {
    // It belongs to GameServer, not the config — otherwise it could be smuggled
    // in through update_game_config and would reach the sim/records.
    const { handler, created } = captureCreateHandler({ setListed: vi.fn() });
    handler({ body: { ...BASE, listed: true } }, mockRes());
    expect(created.config).toBeDefined();
    expect("listed" in created.config!).toBe(false);
  });

  it("refuses to list an allowlisted lobby, and mints nothing", () => {
    // Advertising a lobby that rejects every joiner; the whitelist is stripped
    // from the broadcast so browsers could not tell why.
    const setListed = vi.fn();
    const { handler, created } = captureCreateHandler({ setListed });
    const res = mockRes();
    handler(
      { body: { ...BASE, listed: true, allowedPublicIds: ["abc"] } },
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "listing_whitelist_enabled" });
    expect(created.config).toBeUndefined(); // guarded before createGame
    expect(setListed).not.toHaveBeenCalled();
  });

  it("still allows an allowlist when NOT listing", () => {
    const { handler } = captureCreateHandler({ setListed: vi.fn() });
    const res = mockRes();
    handler({ body: { ...BASE, allowedPublicIds: ["abc"] } }, res);
    expect(res.statusCode).toBe(200);
  });

  it("refuses to list a lobby with host cheats", () => {
    const { handler } = captureCreateHandler({ setListed: vi.fn() });
    const res = mockRes();
    handler({ body: { ...BASE, listed: true, hostCheats: {} } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "listing_host_cheats_enabled" });
  });

  it("400s a non-boolean listed", () => {
    const { handler } = captureCreateHandler({ setListed: vi.fn() });
    const res = mockRes();
    handler({ body: { ...BASE, listed: "yes" } }, res);
    expect(res.statusCode).toBe(400);
  });
});
