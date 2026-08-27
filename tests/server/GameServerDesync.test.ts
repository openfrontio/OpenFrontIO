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

// Characterization tests for what the turn loop does with the desync
// verdict every ten turns: the desync frame, the desync count, and the hash
// recorded on an agreed turn. The tally itself is covered in
// DesyncDetector.test.ts. See docs/GameServerRefactor.md, Phase 1.

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
