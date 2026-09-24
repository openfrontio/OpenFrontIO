import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { ServerEnv } from "../../src/server/ServerEnv";

// Capture the create_pool handler off a fake Express app, the way the other
// admin-bot route tests do. requireAdminBotKey is the preceding middleware and
// is tested separately.
function captureHandler(opts: { taken?: string[] } = {}) {
  const routes: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    post(path: string, ...handlers: ((req: any, res: any) => void)[]) {
      routes[path] = handlers[handlers.length - 1];
    },
    get() {},
  };
  const created: {
    id: string;
    config: any;
    listed: boolean;
    autoStartAt?: number;
  }[] = [];
  const taken = new Set(opts.taken ?? []);
  const gm: any = {
    game: (id: string) => (taken.has(id) ? {} : null),
    createGame(id: string, config: any) {
      const record: (typeof created)[number] = { id, config, listed: false };
      created.push(record);
      return {
        setListed: (v: boolean) => {
          record.listed = v;
          record.autoStartAt = v ? LISTED_DEADLINE : undefined;
        },
        autoStartAt: () => record.autoStartAt,
        setPoolAutoStartAt: (deadline: number) => {
          record.autoStartAt = deadline;
        },
        setFeatured: vi.fn(),
        gameInfo: () => ({ gameID: id }),
      };
    },
  };
  const log: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  registerAdminBotRoutes({ app, gm, workerId: 0, log });
  return { handler: routes["/api/adminbot/create_pool"], created };
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
const LISTED_DEADLINE = 1_700_000_300_000;

// Ids are minted one at a time; hand out a distinct one per call.
let minted: string[];

beforeEach(() => {
  minted = ["aaaa1111", "bbbb2222", "cccc3333", "dddd4444"];
  vi.spyOn(ServerEnv, "generateGameIdForWorker").mockImplementation(
    () => minted.shift() ?? null,
  );
  vi.spyOn(ServerEnv, "workerPath").mockReturnValue("w0");
});

describe("admin bot create_pool", () => {
  it("creates every member with one identical pool", () => {
    const { handler, created } = captureHandler();
    const res = mockRes();
    handler({ body: { ...BASE, count: 3 } }, res);

    expect(res.statusCode).toBe(200);
    expect(created.map((c) => c.id)).toEqual([
      "aaaa1111",
      "bbbb2222",
      "cccc3333",
    ]);

    // One pool object, same id and same sibling order on every member — the
    // members have to agree or they disagree about who belongs where.
    const pools = created.map((c) => c.config.pool);
    for (const pool of pools) {
      expect(pool).toEqual(pools[0]);
      expect(pool.siblings).toEqual(["aaaa1111", "bbbb2222", "cccc3333"]);
    }
    // And each member is in its own pool, or it would route every joiner away.
    for (const member of created) {
      expect(member.config.pool.siblings).toContain(member.id);
    }
    expect(res.body.poolId).toBe(pools[0].id);
    expect(res.body.lobbies.map((l: any) => l.gameID)).toEqual([
      "aaaa1111",
      "bbbb2222",
      "cccc3333",
    ]);
  });

  it("lists only the entry lobby", () => {
    const { handler, created } = captureHandler();
    handler({ body: { ...BASE, count: 3, listed: true } }, mockRes());
    expect(created.map((c) => c.listed)).toEqual([true, false, false]);
  });

  it("starts every member on the entry's deadline", () => {
    // Most joiners are routed off the entry, so an unlisted member with no
    // deadline would hold them until the maximum game duration.
    const { handler, created } = captureHandler();
    handler({ body: { ...BASE, count: 3, listed: true } }, mockRes());
    expect(created.map((c) => c.autoStartAt)).toEqual([
      LISTED_DEADLINE,
      LISTED_DEADLINE,
      LISTED_DEADLINE,
    ]);
  });

  it("gives an unlisted pool no deadline, like an unlisted lobby", () => {
    const { handler, created } = captureHandler();
    handler({ body: { ...BASE, count: 3 } }, mockRes());
    expect(created.map((c) => c.autoStartAt)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("refuses a count above the cap", () => {
    const { handler, created } = captureHandler();
    const res = mockRes();
    handler({ body: { ...BASE, count: 9 } }, res);
    expect(res.statusCode).toBe(400);
    expect(created).toEqual([]);
  });

  it("refuses a pool of one, which would never route anyone", () => {
    const { handler, created } = captureHandler();
    const res = mockRes();
    handler({ body: { ...BASE, count: 1 } }, res);
    expect(res.statusCode).toBe(400);
    expect(created).toEqual([]);
  });

  it("creates nothing when an id cannot be allocated", () => {
    // Third mint collides with a live game: the whole request fails before any
    // lobby exists, rather than leaving members naming a sibling that does not.
    const { handler, created } = captureHandler({ taken: ["cccc3333"] });
    const res = mockRes();
    handler({ body: { ...BASE, count: 3 } }, res);

    expect(res.statusCode).toBe(500);
    expect(created).toEqual([]);
  });

  it("refuses a caller-supplied pool", () => {
    const { handler, created } = captureHandler();
    const res = mockRes();
    handler(
      {
        body: {
          ...BASE,
          count: 2,
          pool: { id: "mine", siblings: ["aaaa1111", "bbbb2222"] },
        },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("pool_is_generated");
    expect(created).toEqual([]);
  });

  it("refuses team pins, which name one lobby", () => {
    const { handler, created } = captureHandler();
    const res = mockRes();
    handler(
      {
        body: {
          ...BASE,
          gameMode: "Team",
          playerTeams: 2,
          count: 2,
          teams: [],
        },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("teams_unsupported_for_pool");
    expect(created).toEqual([]);
  });
});
