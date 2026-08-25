import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { Client } from "../../src/server/Client";
import { GameServer } from "../../src/server/GameServer";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Characterization tests for desync detection: the hash tally itself
// (findOutOfSyncClients) and what the turn loop does with its verdict every
// ten turns. See docs/GameServerRefactor.md, Phase 1.

const TURN_MS = 100;
const IDS = ["a", "b", "c", "d"].map(cid);

async function reportHash(client: Client, turnNumber: number, hash: number) {
  await mockWsOf(client).emit({ type: "hash", hash, turnNumber });
}

function lobbyWith(count: number) {
  const game = makeGame();
  const clients = IDS.slice(0, count).map((clientID) =>
    makeClient({ clientID }),
  );
  for (const c of clients) game.joinClient(c);
  return { game, clients };
}

describe("GameServer.findOutOfSyncClients", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("flags the minority that disagrees with the majority hash", async () => {
    const { game, clients } = lobbyWith(3);
    const [a, b, c] = clients;
    await reportHash(a, 0, 1);
    await reportHash(b, 0, 1);
    await reportHash(c, 0, 2);

    const result = game.findOutOfSyncClients(0);
    expect(result.mostCommonHash).toBe(1);
    expect(result.outOfSyncClients).toEqual([c]);
  });

  it("treats everyone as out of sync when no hash has a majority", async () => {
    // Three different answers: whichever hash was seen first "wins" the
    // count, but with a strict majority disagreeing nobody can be trusted.
    const { game, clients } = lobbyWith(3);
    const [a, b, c] = clients;
    await reportHash(a, 0, 1);
    await reportHash(b, 0, 2);
    await reportHash(c, 0, 3);

    const result = game.findOutOfSyncClients(0);
    expect(result.mostCommonHash).toBe(1);
    expect(result.outOfSyncClients).toEqual([a, b, c]);
  });

  it("keeps an even split as-is, siding with the first-seen hash", async () => {
    // Two of four is not a STRICT majority, so only the second pair is
    // flagged rather than the whole room.
    const { game, clients } = lobbyWith(4);
    const [a, b, c, d] = clients;
    await reportHash(a, 0, 1);
    await reportHash(b, 0, 1);
    await reportHash(c, 0, 2);
    await reportHash(d, 0, 2);

    const result = game.findOutOfSyncClients(0);
    expect(result.mostCommonHash).toBe(1);
    expect(result.outOfSyncClients).toEqual([c, d]);
  });

  it("ignores clients that have not reported that turn", async () => {
    const { game, clients } = lobbyWith(3);
    const [a, b] = clients;
    await reportHash(a, 0, 1);
    await reportHash(b, 0, 1);
    await reportHash(b, 1, 7); // a different turn does not count either

    const result = game.findOutOfSyncClients(0);
    expect(result.mostCommonHash).toBe(1);
    expect(result.outOfSyncClients).toEqual([]);
  });

  it("has nothing to compare with one report, or none", async () => {
    const { game, clients } = lobbyWith(1);
    expect(game.findOutOfSyncClients(0)).toEqual({
      mostCommonHash: null,
      outOfSyncClients: [],
    });

    await reportHash(clients[0], 0, 1);
    expect(game.findOutOfSyncClients(0)).toEqual({
      mostCommonHash: 1,
      outOfSyncClients: [],
    });
  });
});

describe("desync handling in the turn loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // The turn log as a reconnecting client would receive it.
  function replayedTurns(game: GameServer, persistentID: string, ctx: any) {
    const ws = makeMockWs();
    if (!game.rejoinClient(ws as any, persistentID, 0)) {
      throw new Error("rejoin failed");
    }
    const start = ws.sent(ctx).find((m) => m.type === "start");
    if (start?.type !== "start") throw new Error("no start frame");
    return start.turns;
  }

  function startedWith(count: number) {
    const { game, clients } = lobbyWith(count);
    startGame(game);
    const ctx = createGameWireContext(
      clients.map((c) => ({ clientID: c.clientID })),
    );
    return { game, clients, ctx };
  }

  const desyncFramesOn = (client: Client, ctx: any) =>
    mockWsOf(client)
      .sent(ctx)
      .filter((m) => m.type === "desync");

  it("records the agreed hash on the turn and tells nobody", async () => {
    const { game, clients, ctx } = startedWith(3);
    for (const c of clients) await reportHash(c, 0, 1234);
    // The check for turn 0 runs once ten turns are in the log.
    vi.advanceTimersByTime(10 * TURN_MS);

    for (const c of clients) expect(desyncFramesOn(c, ctx)).toEqual([]);
    expect(game.numDesyncedClients()).toBe(0);
    const turns = replayedTurns(game, clients[0].persistentID, ctx);
    expect(turns[0].hash).toBe(1234);
  });

  it("tells a disagreeing client once, counts it, and records no hash", async () => {
    const { game, clients, ctx } = startedWith(3);
    const [a, b, c] = clients;
    // c disagrees on turn 0 and again on turn 10.
    for (const x of [a, b]) await reportHash(x, 0, 1234);
    await reportHash(c, 0, 4321);
    for (const x of [a, b]) await reportHash(x, 10, 5678);
    await reportHash(c, 10, 8765);
    // Checks run at 10 turns (for turn 0) and 20 turns (for turn 10).
    vi.advanceTimersByTime(20 * TURN_MS);

    expect(desyncFramesOn(a, ctx)).toEqual([]);
    expect(desyncFramesOn(b, ctx)).toEqual([]);
    // One notice, for the first disagreement; the second is not repeated.
    expect(desyncFramesOn(c, ctx)).toEqual([
      {
        type: "desync",
        turn: 0,
        correctHash: 1234,
        clientsWithCorrectHash: 2,
        totalActiveClients: 3,
      },
    ]);
    expect(game.numDesyncedClients()).toBe(1);

    // A contested turn gets no hash in the log.
    const turns = replayedTurns(game, a.persistentID, ctx);
    expect(turns[0].hash).toBeUndefined();
    expect(turns[10].hash).toBeUndefined();
  });

  it("does not check at all with a single active client", async () => {
    // Nothing to compare against — so even a reported hash is not recorded.
    const { game, clients, ctx } = startedWith(1);
    await reportHash(clients[0], 0, 1234);
    vi.advanceTimersByTime(10 * TURN_MS);

    expect(game.numDesyncedClients()).toBe(0);
    const turns = replayedTurns(game, clients[0].persistentID, ctx);
    expect(turns[0].hash).toBeUndefined();
  });
});
