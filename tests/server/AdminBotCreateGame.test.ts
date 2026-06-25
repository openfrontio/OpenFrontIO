import { describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";

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

// Capture the route handlers registered on a fake Express app so we can invoke
// the create_game handler directly. requireAdminBotKey is registered as the
// preceding middleware (tested separately); we call the final handler.
function captureCreateHandler() {
  const routes: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    post(path: string, ...handlers: ((req: any, res: any) => void)[]) {
      routes[path] = handlers[handlers.length - 1];
    },
    get() {},
  };
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerAdminBotRoutes({ app, gm: {} as any, workerId: 0, log });
  return routes["/api/adminbot/create_game"];
}

describe("admin bot create_game gameType guard", () => {
  it("rejects a Singleplayer game with 400", () => {
    const handler = captureCreateHandler();
    const res = mockRes();
    handler({ body: { gameType: GameType.Singleplayer } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/private games/);
  });

  it("rejects a Public game with 400", () => {
    const handler = captureCreateHandler();
    const res = mockRes();
    handler({ body: { gameType: GameType.Public } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/private games/);
  });
});
