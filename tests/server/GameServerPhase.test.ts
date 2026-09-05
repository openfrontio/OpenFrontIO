import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, CloseReason } from "../../src/core/CloseCodes";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { GameManager } from "../../src/server/GameManager";
import { GamePhase } from "../../src/server/GameServer";
import {
  cid,
  makeClient,
  makeGame,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Characterization tests for the time-driven parts of GameServer: the phase
// GameManager polls, the 60s ping prune that runs inside it, and the
// connection-status marks the turn loop injects every five turns. See
// docs/GameServerRefactor.md, Phase 1.

const T0 = 1_700_000_000_000;
const TURN_MS = 100;
const HOUR = 60 * 60 * 1000;

describe("GameServer.phase()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("is Lobby until startsAt, then Active", () => {
    const game = makeGame({ startsAt: T0 + 10_000 });
    game.joinClient(makeClient());
    expect(game.phase()).toBe(GamePhase.Lobby);

    vi.advanceTimersByTime(10_001);
    expect(game.phase()).toBe(GamePhase.Active);
  });

  it("stays Lobby indefinitely without a start time", () => {
    const game = makeGame();
    game.joinClient(makeClient());
    vi.advanceTimersByTime(HOUR);
    expect(game.phase()).toBe(GamePhase.Lobby);
  });

  it("leaves Lobby as soon as the last seat fills, before startsAt", () => {
    const game = makeGame({
      startsAt: T0 + 10_000,
      config: { maxPlayers: 1 },
    });
    game.joinClient(makeClient());
    expect(game.phase()).toBe(GamePhase.Active);
  });

  it("finishes an unattended game 30s after its start time", () => {
    // Nobody ever connected: Active through the warm-up window (clients may
    // still be loading), Finished once it passes with no pings received.
    const game = makeGame({ startsAt: T0 + 1000 });
    vi.advanceTimersByTime(1001);
    expect(game.phase()).toBe(GamePhase.Active);

    vi.advanceTimersByTime(30_000);
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("finishes once the game is older than the 3h maximum", () => {
    // Checked ahead of everything else, so even a lobby that never got a
    // start time is reaped.
    const game = makeGame({ createdAt: T0 - 3 * HOUR - 1 });
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("drops a client that has not pinged for 60s and keeps one that has", async () => {
    const game = makeGame({ startsAt: T0 + 1000 });
    const quiet = makeClient({ clientID: cid("quiet") });
    const chatty = makeClient({ clientID: cid("chatty") });
    game.joinClient(quiet);
    game.joinClient(chatty);

    vi.advanceTimersByTime(60_500);
    await mockWsOf(chatty).emit({ type: "ping" });

    game.pruneStaleClients();
    expect(game.phase()).toBe(GamePhase.Active);
    expect(mockWsOf(quiet).close).toHaveBeenCalledWith(
      CloseCode.Normal,
      CloseReason.NoHeartbeat,
    );
    expect(mockWsOf(chatty).close).not.toHaveBeenCalled();
    expect(game.numClients()).toBe(1);
  });

  it("finishes a started game once every client has gone quiet", () => {
    const game = makeGame({ startsAt: T0 + 1000 });
    game.joinClient(makeClient());
    game.joinClient(makeClient());
    vi.advanceTimersByTime(1001);
    startGame(game);

    // 60s without pings prunes both; the game is then unattended.
    vi.advanceTimersByTime(60_500);
    game.pruneStaleClients();
    expect(game.phase()).toBe(GamePhase.Finished);
    expect(game.numClients()).toBe(0);
  });

  it("reads the phase without pruning; only pruneStaleClients drops anyone", () => {
    const game = makeGame({ startsAt: T0 + 1000 });
    const quiet = makeClient({ clientID: cid("quiet") });
    game.joinClient(quiet);
    vi.advanceTimersByTime(60_500);

    expect(game.phase()).toBe(GamePhase.Active);
    expect(mockWsOf(quiet).close).not.toHaveBeenCalled();
    expect(game.numClients()).toBe(1);

    game.pruneStaleClients();
    expect(mockWsOf(quiet).close).toHaveBeenCalled();
    expect(game.numClients()).toBe(0);
  });

  it("does not prune once the game has ended", async () => {
    // end() closes the sockets but leaves the roster to the close events;
    // the prune must not get ahead of them on a game that is already over.
    const game = makeGame();
    game.joinClient(makeClient({ clientID: cid("quiet") }));
    await game.end();
    vi.advanceTimersByTime(60_500);

    game.pruneStaleClients();
    expect(game.numClients()).toBe(1);
  });
});

describe("GameManager and the ping prune", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("prunes on tick, not on a lobby-browser read", () => {
    const gm = new GameManager(mockLogger());
    const game = gm.createGame(cid("game"), undefined, "host-pid")!;
    game.setListed(true);
    const quiet = makeClient({
      clientID: cid("quiet"),
      persistentID: "host-pid",
    });
    game.joinClient(quiet);
    vi.advanceTimersByTime(60_500);

    expect(gm.listedLobbies()).toEqual([game]);
    expect(mockWsOf(quiet).close).not.toHaveBeenCalled();
    expect(game.numClients()).toBe(1);

    gm.tick();
    expect(mockWsOf(quiet).close).toHaveBeenCalledWith(
      CloseCode.Normal,
      CloseReason.NoHeartbeat,
    );
    expect(game.numClients()).toBe(0);
  });
});

describe("connection status marks in the turn log", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // Every mark_disconnected intent the observer's socket received, keyed by
  // the turn it was committed in.
  function marksSeenBy(observerWs: ReturnType<typeof mockWsOf>, ctx: any) {
    const marks: Record<number, [string, boolean][]> = {};
    for (const frame of observerWs.sent(ctx)) {
      if (frame.type !== "turn") continue;
      const found = frame.turn.intents.flatMap((i) =>
        i.type === "mark_disconnected"
          ? [[i.clientID, i.isDisconnected] as [string, boolean]]
          : [],
      );
      if (found.length > 0) marks[frame.turn.turnNumber] = found;
    }
    return marks;
  }

  it("marks a silent player on the next 5-turn boundary, and back once it pings", async () => {
    const P1 = cid("p1");
    const P2 = cid("p2");
    const game = makeGame();
    const p1 = makeClient({ clientID: P1 });
    const p2 = makeClient({ clientID: P2 });
    game.joinClient(p1);
    game.joinClient(p2);
    startGame(game);
    const ctx = createGameWireContext([{ clientID: P1 }, { clientID: P2 }]);

    // p1 went quiet more than 30s ago (the disconnect timeout).
    p1.lastPing = Date.now() - 31_000;
    // Turns 0..5: the check fires as turn 4 commits (5 turns in the log),
    // and its mark rides in turn 5.
    vi.advanceTimersByTime(6 * TURN_MS);
    expect(game.isClientDisconnected(P1)).toBe(true);
    expect(game.isClientDisconnected(P2)).toBe(false);

    // p1 is heard from again: the next boundary marks them reconnected.
    await mockWsOf(p1).emit({ type: "ping" });
    vi.advanceTimersByTime(5 * TURN_MS);
    expect(game.isClientDisconnected(P1)).toBe(false);

    expect(marksSeenBy(mockWsOf(p2), ctx)).toEqual({
      // Joining records both as connected.
      0: [
        [P1, false],
        [P2, false],
      ],
      5: [[P1, true]],
      10: [[P1, false]],
    });
  });

  it("never marks a spectator, whose status the simulation cannot use", () => {
    const P1 = cid("p1");
    const CAST = cid("cast");
    const game = makeGame();
    const p1 = makeClient({ clientID: P1 });
    const cast = makeClient({ clientID: CAST, spectator: true });
    game.joinClient(p1);
    game.joinClient(cast);
    startGame(game);
    const ctx = createGameWireContext([{ clientID: P1 }]);

    cast.lastPing = Date.now() - 31_000;
    vi.advanceTimersByTime(6 * TURN_MS);

    // Tracked server-side...
    expect(game.isClientDisconnected(CAST)).toBe(true);
    // ...but never written into the turn log.
    const marks = marksSeenBy(mockWsOf(p1), ctx);
    expect(marks).toEqual({ 0: [[P1, false]] });
  });
});
