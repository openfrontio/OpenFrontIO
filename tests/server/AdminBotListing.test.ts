import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { ServerEnv } from "../../src/server/ServerEnv";

// Capture the listing handler off a fake Express app and invoke it directly.
// requireAdminBotKey is the preceding middleware (tested separately), so this
// exercises the authorization-independent logic: the browser-facing safety
// checks, and that the owner-centric ones are deliberately absent.
function captureListingHandler(
  game: unknown,
  lobbyService: unknown = { hostedLobbyCount: () => 0 },
) {
  const routes: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    post(path: string, ...handlers: ((req: any, res: any) => void)[]) {
      routes[path] = handlers[handlers.length - 1];
    },
    get() {},
  };
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerAdminBotRoutes({
    app,
    gm: { game: () => game } as any,
    workerId: 0,
    log,
    lobbyService: lobbyService as any,
  });
  return routes["/api/adminbot/game/:id/listing"];
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

// A game id this worker owns (workerIndex 0 of 1) — ownsGame() rejects otherwise.
const OWNED_ID = "aaaaaaaa";

function fakeGame(over: Record<string, unknown> = {}) {
  return {
    id: OWNED_ID,
    isPublic: () => false,
    hasStarted: () => false,
    hasJoinWhitelist: () => false,
    hasHostCheats: () => false,
    setListed: vi.fn(),
    ...over,
  };
}

const req = (listed: boolean) => ({
  params: { id: OWNED_ID },
  body: { listed },
});

beforeEach(() => {
  // ownsGame() derives the owning worker from the id, which needs NUM_WORKERS in
  // the environment. Same approach as the LiveStats route test.
  vi.spyOn(ServerEnv, "workerIndex").mockReturnValue(0);
});

describe("admin bot lobby listing", () => {
  it("lists a clean private lobby", () => {
    const game = fakeGame();
    const res = mockRes();
    captureListingHandler(game)(req(true), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ listed: true });
    expect(game.setListed).toHaveBeenCalledWith(true);
  });

  it("delists without re-running the listing guards", () => {
    // Unlisting must always be possible — otherwise a lobby that became
    // ineligible (whitelist added) could never be withdrawn.
    const game = fakeGame({ hasJoinWhitelist: () => true });
    const res = mockRes();
    captureListingHandler(game)(req(false), res);
    expect(res.statusCode).toBe(200);
    expect(game.setListed).toHaveBeenCalledWith(false);
  });

  it("refuses a whitelisted lobby (would reject every joiner it advertised)", () => {
    const game = fakeGame({ hasJoinWhitelist: () => true });
    const res = mockRes();
    captureListingHandler(game)(req(true), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "listing_whitelist_enabled" });
    expect(game.setListed).not.toHaveBeenCalled();
  });

  it("refuses a lobby with host cheats", () => {
    const game = fakeGame({ hasHostCheats: () => true });
    const res = mockRes();
    captureListingHandler(game)(req(true), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "listing_host_cheats_enabled" });
  });

  it("refuses a public or already-started game", () => {
    for (const over of [{ isPublic: () => true }, { hasStarted: () => true }]) {
      const res = mockRes();
      captureListingHandler(fakeGame(over))(req(true), res);
      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({ error: "Game cannot be listed" });
    }
  });

  it("enforces the cluster-wide hosted-lobby cap", () => {
    const res = mockRes();
    captureListingHandler(fakeGame(), { hostedLobbyCount: () => 10 })(
      req(true),
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "listing_full" });
  });

  it("404s an unknown game", () => {
    const res = mockRes();
    captureListingHandler(null)(req(true), res);
    expect(res.statusCode).toBe(404);
  });

  it("400s a malformed body", () => {
    const res = mockRes();
    captureListingHandler(fakeGame())(
      { params: { id: OWNED_ID }, body: { listed: "yes" } } as any,
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("does NOT consult a creator or subscription — an unowned lobby still lists", () => {
    // The whole point: an admin-bot lobby has no creatorPersistentID, so any
    // isCreator/subscription/one-per-creator check would reject it forever. A
    // game exposing none of those members must still list cleanly.
    const bare = {
      id: OWNED_ID,
      isPublic: () => false,
      hasStarted: () => false,
      hasJoinWhitelist: () => false,
      hasHostCheats: () => false,
      setListed: vi.fn(),
    };
    const res = mockRes();
    captureListingHandler(bare)(req(true), res);
    expect(res.statusCode).toBe(200);
    expect(bare.setListed).toHaveBeenCalledWith(true);
  });
});
