import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdminBotKey } from "../../src/server/AdminBotRoutes";

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res;
}

describe("requireAdminBotKey", () => {
  const KEY = "super-secret-bot-key";

  beforeEach(() => {
    delete process.env.ADMIN_BOT_API_KEY;
  });

  afterEach(() => {
    delete process.env.ADMIN_BOT_API_KEY;
    vi.restoreAllMocks();
  });

  it("returns 404 when the feature is disabled (key unset)", () => {
    const res = mockRes();
    const next = vi.fn();
    requireAdminBotKey({ headers: {} } as any, res, next);
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the header is missing", () => {
    process.env.ADMIN_BOT_API_KEY = KEY;
    const res = mockRes();
    const next = vi.fn();
    requireAdminBotKey({ headers: {} } as any, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the key is wrong", () => {
    process.env.ADMIN_BOT_API_KEY = KEY;
    const res = mockRes();
    const next = vi.fn();
    requireAdminBotKey(
      { headers: { "x-admin-bot-key": "nope" } } as any,
      res,
      next,
    );
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when the key matches", () => {
    process.env.ADMIN_BOT_API_KEY = KEY;
    const res = mockRes();
    const next = vi.fn();
    requireAdminBotKey(
      { headers: { "x-admin-bot-key": KEY } } as any,
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});
