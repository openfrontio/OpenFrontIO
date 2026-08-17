import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdminBotRoutes } from "../../src/server/AdminBotRoutes";
import { ServerEnv } from "../../src/server/ServerEnv";

// Capture the create_game handler off a fake Express app, recording what reaches
// GameManager.createGame — the pinned teams arrive as its 6th argument, and must
// never appear inside GameConfig.
function captureCreateHandler() {
  const routes: Record<string, (req: any, res: any) => void> = {};
  const app: any = {
    post(path: string, ...handlers: ((req: any, res: any) => void)[]) {
      routes[path] = handlers[handlers.length - 1];
    },
    get() {},
  };
  const created: {
    config?: Record<string, unknown>;
    teams?: string[][];
  } = {};
  const gm: any = {
    createGame(
      _id: string,
      config: Record<string, unknown>,
      _creator?: string,
      _startsAt?: number,
      _publicGameType?: unknown,
      matchmakingTeams?: string[][],
    ) {
      created.config = config;
      created.teams = matchmakingTeams;
      return { setListed: vi.fn(), gameInfo: () => ({ gameID: "x" }) };
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

const TEAM = { gameMap: "World", gameMode: "Team" };
const FFA = { gameMap: "World", gameMode: "Free For All" };

beforeEach(() => {
  vi.spyOn(ServerEnv, "generateGameIdForWorker").mockReturnValue("aaaaaaaa");
  vi.spyOn(ServerEnv, "workerPath").mockReturnValue("w0");
});

describe("admin bot create_game team pinning", () => {
  it("passes the pinned teams through to createGame", () => {
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    const teams = [
      ["pubA", "pubB"],
      ["pubC", "pubD"],
    ];
    handler({ body: { ...TEAM, teams } }, res);
    expect(res.statusCode).toBe(200);
    expect(created.teams).toEqual(teams);
  });

  it("keeps teams OUT of GameConfig", () => {
    // Same rule as `listed`: not a GameConfig field, so update_game_config can
    // never set it after the lobby exists.
    const { handler, created } = captureCreateHandler();
    handler({ body: { ...TEAM, teams: [["pubA", "pubB"]] } }, mockRes());
    expect(created.config).not.toHaveProperty("teams");
    expect(created.config).not.toHaveProperty("matchmakingTeams");
  });

  it("creates an unpinned game when teams are omitted", () => {
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    handler({ body: { ...TEAM } }, res);
    expect(res.statusCode).toBe(200);
    expect(created.teams).toBeUndefined();
  });

  it("refuses teams in FFA, where a pin would be silently inert", () => {
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    handler({ body: { ...FFA, teams: [["pubA", "pubB"]] } }, res);
    expect(res.statusCode).toBe(400);
    expect(created.teams).toBeUndefined();
  });

  it("refuses a publicId listed in two teams", () => {
    // findIndex takes the first match, so the caller would silently get a team
    // it did not ask for.
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    handler({ body: { ...TEAM, teams: [["pubA", "pubB"], ["pubA"]] } }, res);
    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toContain("pubA");
    expect(created.teams).toBeUndefined();
  });

  it("refuses more pinned teams than the lobby has slots", () => {
    // A pin is an index into the team list, so one past the end resolves to no
    // team and the player is silently unpinned.
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    handler(
      { body: { ...TEAM, playerTeams: 2, teams: [["a"], ["b"], ["c"]] } },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(String(res.body.error)).toContain("playerTeams");
    expect(created.teams).toBeUndefined();
  });

  it("accepts exactly as many teams as there are slots", () => {
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    handler(
      { body: { ...TEAM, playerTeams: 3, teams: [["a"], ["b"], ["c"]] } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(created.teams).toHaveLength(3);
  });

  it.each(["Duos", "Trios", "Quads"])(
    "refuses pins alongside %s, whose team count depends on attendance",
    (mode) => {
      // Duos/Trios/Quads resolve to ceil(players / size) at START, which can land
      // below the number of teams pinned if fewer players turn up than seeded.
      const { handler, created } = captureCreateHandler();
      const res = mockRes();
      handler(
        { body: { ...TEAM, playerTeams: mode, teams: [["a"], ["b"]] } },
        res,
      );
      expect(res.statusCode).toBe(400);
      expect(String(res.body.error)).toContain("numeric playerTeams");
      expect(created.teams).toBeUndefined();
    },
  );

  it("still pins when playerTeams is omitted", () => {
    // Unchanged behaviour: no declared count, nothing to contradict.
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    handler({ body: { ...TEAM, teams: [["a"], ["b"]] } }, res);
    expect(res.statusCode).toBe(200);
    expect(created.teams).toHaveLength(2);
  });

  it("rejects a malformed teams payload", () => {
    const { handler } = captureCreateHandler();
    const res = mockRes();
    handler({ body: { ...TEAM, teams: ["not-an-array"] } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("accepts an empty teams list without pinning anyone", () => {
    const { handler, created } = captureCreateHandler();
    const res = mockRes();
    handler({ body: { ...TEAM, teams: [] } }, res);
    expect(res.statusCode).toBe(200);
    expect(created.teams).toEqual([]);
  });
});
