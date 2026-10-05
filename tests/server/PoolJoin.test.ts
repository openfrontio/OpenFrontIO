import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import {
  GameConfig,
  GameConfigSchema,
  PoolConfig,
  PoolConfigSchema,
} from "../../src/core/Schemas";
import { CreateGameInputSchema } from "../../src/core/WorkerSchemas";
import { poolIndexFor } from "../../src/server/PoolRouting";
import {
  cid,
  makeClient as harnessClient,
  makeGame as harnessGame,
  makeMockWs,
  mockWsOf,
} from "../util/GameServerHarness";
import { testGameConfig } from "../util/Wire";

const C1 = cid("c1");
const C2 = cid("c2");
const C3 = cid("c3");
const C4 = cid("c4");

const POOL_ID = "pool-1";
// The game under test is the harness default id, and it is the entry point:
// a member recognises itself by its own id, so it has to be in this list.
const HERE = cid("game");
const SIBLINGS = [HERE, "bbbb2222", "cccc3333", "dddd4444"];

// A publicId the pool assigns to `index`, found by search rather than
// hardcoded, so these tests say what they mean instead of depending on what
// simpleHash happens to produce for a particular string.
function publicIdFor(index: number): string {
  for (let i = 0; i < 1000; i++) {
    const publicId = `pub-${i}`;
    if (poolIndexFor(`${POOL_ID}:${publicId}`, SIBLINGS.length) === index) {
      return publicId;
    }
  }
  throw new Error(`no publicId found for pool index ${index}`);
}

const STAYS = publicIdFor(0);
const MOVES = publicIdFor(2);

function makeClient(
  clientID: string,
  persistentID: string,
  publicId: string | undefined,
  opts: { role?: string | null; spectator?: boolean } = {},
) {
  return harnessClient({
    clientID,
    persistentID,
    publicId,
    role: opts.role ?? null,
    spectator: opts.spectator ?? false,
    username: "TestUser",
  });
}

const POOL: PoolConfig = { id: POOL_ID, siblings: SIBLINGS };

// Member 0 of the pool by default; `extra` layers on the other join gates.
function makeGame(
  extra: Partial<GameConfig> = {},
  pool: PoolConfig | null = POOL,
) {
  return harnessGame({
    config: {
      gameType: GameType.Private,
      ...(pool === null ? {} : { pool }),
      ...extra,
    },
  });
}

const redirectsOf = (client: ReturnType<typeof makeClient>) =>
  mockWsOf(client)
    .sent()
    .filter((m) => m.type === "redirect");

describe("GameServer - pool routing (GameConfig.pool)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("admits a joiner this member is assigned", () => {
    const game = makeGame();
    const client = makeClient(C1, "p1", STAYS);
    expect(game.joinClient(client)).toBe("joined");
    expect(redirectsOf(client)).toEqual([]);
  });

  it("redirects a joiner assigned elsewhere to their own member", () => {
    const game = makeGame();
    const client = makeClient(C1, "p1", MOVES);
    expect(game.joinClient(client)).toBe("redirected");
    expect(redirectsOf(client)).toEqual([
      { type: "redirect", gameID: SIBLINGS[2] },
    ]);
  });

  it("gives a redirected joiner no seat here", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient(C1, "p1", MOVES))).toBe("redirected");
    expect(game.numClients()).toBe(0);
    // And no reconnect mapping was left behind for them either.
    expect(game.rejoinClient(makeMockWs() as any, "p1")).toBe(false);
  });

  it("sends the same joiner to the same member every time", () => {
    // What makes leaving and coming back land you back where you were.
    const game = makeGame();
    for (const clientID of [C1, C2, C3]) {
      const client = makeClient(clientID, "p1", MOVES);
      expect(game.joinClient(client)).toBe("redirected");
      expect(redirectsOf(client)).toEqual([
        { type: "redirect", gameID: SIBLINGS[2] },
      ]);
    }
  });

  it("routes a joiner with no publicId by their persistentID", () => {
    // Dev-only: in production every joiner, anonymous or not, has a publicId,
    // and a raw persistentID token is refused. This pins the fallback so a dev
    // server still pools, and both answers have to turn up across a spread.
    const results = new Set(
      Array.from({ length: 40 }, (_, i) =>
        makeGame().joinClient(makeClient(C1, `anon-${i}`, undefined)),
      ),
    );
    expect(results).toEqual(new Set(["joined", "redirected"]));

    // And the same persistentID gets the same answer every time.
    const first = makeGame().joinClient(makeClient(C1, "anon-7", undefined));
    expect(makeGame().joinClient(makeClient(C2, "anon-7", undefined))).toBe(
      first,
    );
  });

  it("does not route anyone when the lobby has no pool", () => {
    const game = makeGame({}, null);
    const client = makeClient(C1, "p1", MOVES);
    expect(game.joinClient(client)).toBe("joined");
    expect(redirectsOf(client)).toEqual([]);
  });

  it("lets spectators watch the member they asked for", () => {
    const game = makeGame();
    const client = makeClient(C1, "p1", MOVES, { spectator: true });
    expect(game.joinClient(client)).toBe("joined");
    expect(redirectsOf(client)).toEqual([]);
  });

  it("lets admins and root into any member", () => {
    const game = makeGame();
    expect(
      game.joinClient(makeClient(C1, "p1", MOVES, { role: "admin" })),
    ).toBe("joined");
    expect(game.joinClient(makeClient(C2, "p2", MOVES, { role: "root" }))).toBe(
      "joined",
    );
  });

  it("does not let mod or unknown roles bypass the pool", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient(C1, "p1", MOVES, { role: "mod" }))).toBe(
      "redirected",
    );
    expect(
      game.joinClient(makeClient(C2, "p2", MOVES, { role: "flagged" })),
    ).toBe("redirected");
  });

  it("keeps an explicitly allowlisted publicId on this member", () => {
    // Naming someone is the statement that the hash does not get a vote:
    // this is how a caller pins a player to a chosen member.
    const game = makeGame({ allowedPublicIds: [MOVES] });
    const client = makeClient(C1, "p1", MOVES);
    expect(game.joinClient(client)).toBe("joined");
    expect(redirectsOf(client)).toEqual([]);
  });

  it("refuses a client the allowlist excludes before routing them", () => {
    // Order matters: someone who may not be in this group of lobbies at all
    // must hear that, not be sent on to a sibling that will refuse them too.
    const game = makeGame({ allowedPublicIds: [STAYS] });
    const client = makeClient(C1, "p1", MOVES);
    expect(game.joinClient(client)).toBe("not_allowlisted");
    expect(redirectsOf(client)).toEqual([]);
  });

  it("refuses an untrusted client before routing them", () => {
    const game = makeGame({ trusted: true });
    const client = makeClient(C1, "p1", MOVES);
    expect(game.joinClient(client)).toBe("not_trusted");
    expect(redirectsOf(client)).toEqual([]);
  });

  it("keeps a kicked client kicked rather than routing them", () => {
    const game = makeGame();
    const client = makeClient(C1, "p1", STAYS);
    expect(game.joinClient(client)).toBe("joined");
    game.kickClient(C1);
    expect(game.joinClient(makeClient(C4, "p1", STAYS))).toBe("kicked");
  });

  it("refuses a spectator a seat on a member that is not theirs", async () => {
    // Spectators pick their own member, so the seat toggle is where the pool
    // gets its say — otherwise joining with spectator: true and flipping is a
    // way past routing altogether.
    const game = makeGame();
    const caster = makeClient(C1, "p1", MOVES, { spectator: true });
    expect(game.joinClient(caster)).toBe("joined");

    await mockWsOf(caster).emit({ type: "spectate", spectator: false });
    expect(caster.spectator).toBe(true);
  });

  it("lets a spectator take a seat on the member that is theirs", async () => {
    const game = makeGame();
    const caster = makeClient(C2, "p2", STAYS, { spectator: true });
    expect(game.joinClient(caster)).toBe("joined");

    await mockWsOf(caster).emit({ type: "spectate", spectator: false });
    expect(caster.spectator).toBe(false);
  });

  it("does not route a player who is already in this game", () => {
    // A mid-game drop reconnects as a fresh join, so routing has to know that
    // this player is here already — structurally, not by trusting that the
    // hash still says the same thing. Here the reason they were admitted (the
    // allowlist) is gone by the time they come back.
    const game = makeGame({ allowedPublicIds: [MOVES] });
    const client = makeClient(C1, "p1", MOVES);
    expect(game.joinClient(client)).toBe("joined");
    game.updateGameConfig({ allowedPublicIds: [] });
    game.start();

    const back = makeClient(C4, "p1", MOVES);
    expect(game.joinClient(back)).toBe("joined");
    expect(redirectsOf(back)).toEqual([]);
  });

  it("does not re-route a seated client that reconnects", () => {
    const game = makeGame();
    const client = makeClient(C1, "p1", STAYS);
    expect(game.joinClient(client)).toBe("joined");

    const newWs = makeMockWs();
    expect(game.rejoinClient(newWs as any, "p1")).toBe(true);
    expect(newWs.sent().filter((m) => m.type === "redirect")).toEqual([]);
  });

  it("starts an unlisted member on the pool deadline", () => {
    const game = makeGame();
    const deadline = Date.now() + 60_000;
    game.setPoolAutoStartAt(deadline);
    expect(game.gameInfo().autoStartAt).toBe(deadline);

    game.maybeAutoStartListed();
    expect(game.gameInfo().startsAt).toBeUndefined();

    vi.advanceTimersByTime(60_000);
    game.maybeAutoStartListed();
    expect(game.gameInfo().startsAt).toBeDefined();
  });

  it("keeps the pool out of gameInfo, without touching the stored config", () => {
    // gameInfo goes out over the unauthenticated /api/game/:id route and the
    // lobby_info broadcast every connected client gets, so the sibling ids
    // would otherwise be readable by anyone who can reach the entry lobby.
    const game = makeGame();
    expect(game.gameInfo().gameConfig?.pool).toBeUndefined();
    expect(game.gameConfig.pool).toEqual(POOL);
  });

  it("keeps the pool out of the start info (wire + archived record)", () => {
    // Sibling ids are private lobby ids, which are join secrets.
    const game = makeGame();
    const client = makeClient(C1, "p1", STAYS);
    expect(game.joinClient(client)).toBe("joined");
    game.start();

    const start = mockWsOf(client)
      .sent()
      .find((m) => m.type === "start");
    expect(start).toBeDefined();
    const config = start!.type === "start" ? start!.gameStartInfo.config : null;
    expect(config?.pool).toBeUndefined();
    // The server still routes from its own config.
    expect(game.gameConfig.pool?.siblings).toEqual(SIBLINGS);
  });
});

describe("PoolConfigSchema", () => {
  it("rejects duplicate sibling ids", () => {
    // A repeated id would hold more than one routing slot.
    const parsed = PoolConfigSchema.safeParse({
      id: POOL_ID,
      siblings: ["aaaa1111", "bbbb2222", "aaaa1111"],
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps the sibling list in the order given", () => {
    // Order is part of the assignment, so a duplicate is refused rather than
    // quietly sorted or deduped into a different mapping.
    const siblings = ["cccc3333", "aaaa1111", "bbbb2222"];
    const parsed = PoolConfigSchema.parse({ id: POOL_ID, siblings });
    expect(parsed.siblings).toEqual(siblings);
  });
});

describe("pool is admin-bot-only", () => {
  it("drops a pool from the public create_game input", () => {
    const parsed = CreateGameInputSchema.parse({
      ...testGameConfig(),
      pool: POOL,
    });
    expect(parsed !== undefined && "pool" in parsed).toBe(false);
  });

  it("keeps a pool on the admin-bot input", () => {
    const parsed = GameConfigSchema.partial().parse({ pool: POOL });
    expect(parsed.pool).toEqual(POOL);
  });
});
