import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GameManager } from "../../src/server/GameManager";
import { GamePhase, GameServer } from "../../src/server/GameServer";
import { testGameConfig } from "../util/Wire";

// An empty game must always become Finished so GameManager prunes it.
// A game that auto-started by filling to maxPlayers (or an admin bot game)
// never gets a startsAt, and those used to linger — still ticking turns with
// nobody connected — until the 3 hour maxGameDuration cutoff.
describe("empty game reaping", () => {
  let mockLogger: any;

  const newGame = (startsAt?: number) =>
    new GameServer(
      "testgame",
      mockLogger,
      Date.now(),
      testGameConfig({ gameType: GameType.Private }),
      undefined,
      startsAt,
    );

  const newClient = () =>
    ({
      clientID: "client01",
      username: "client01",
      clanTag: null,
      friends: [],
      lastPing: Date.now(),
      ws: { readyState: 3, send: vi.fn(), close: vi.fn() },
    }) as any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("finishes a started, client-less game that has no startsAt", () => {
    const game = newGame(undefined);
    game.prestart();
    game.start();

    expect(game.phase()).toBe(GamePhase.Active);

    vi.advanceTimersByTime(60_000);

    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("finishes a started, client-less game that has a startsAt", () => {
    const game = newGame(Date.now() + 5_000);
    vi.advanceTimersByTime(5_000);
    game.prestart();
    game.start();

    vi.advanceTimersByTime(60_000);

    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("keeps a just-started game Active through the warmup grace", () => {
    const game = newGame(undefined);
    game.prestart();
    game.start();

    vi.advanceTimersByTime(10_000);

    expect(game.phase()).toBe(GamePhase.Active);
  });

  it("ignores pings from a socket that is off the roster", () => {
    const game = newGame(undefined);
    game.prestart();
    game.start();
    const startClock = (game as any).lastPingUpdate;

    // A socket pruned or kicked out of activeClients keeps its message
    // listener, so it can go on pinging. Those pings must not refresh the
    // game-wide clock the reap waits on.
    const ghost = { clientID: "ghost001", lastPing: Date.now() } as any;
    vi.advanceTimersByTime(60_000);
    (game as any).handlePing(ghost);

    expect((game as any).lastPingUpdate).toBe(startClock);
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("ends an empty game whose ping clock never goes quiet", () => {
    const game = newGame(undefined);
    game.prestart();
    game.start();

    // Backstop only: hold lastPingUpdate warm with nobody on the roster, so
    // the usual reap above can never fire.
    const keepClockWarm = () => ((game as any).lastPingUpdate = Date.now());

    // The timeout runs from the first tick that saw the game empty.
    expect(game.phase()).toBe(GamePhase.Active);

    vi.advanceTimersByTime(9 * 60_000);
    keepClockWarm();
    expect(game.phase()).toBe(GamePhase.Active);

    vi.advanceTimersByTime(2 * 60_000);
    keepClockWarm();
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("keeps a game with a connected client running", () => {
    const game = newGame(undefined);
    const client = newClient();
    (game as any).activeClients = [client];
    game.prestart();
    game.start();

    // Well past both the warmup grace and the empty-game timeout.
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(30_000);
      (game as any).handlePing(client);
      expect(game.phase()).toBe(GamePhase.Active);
    }
  });

  it("finishes a full lobby everyone left before it started", () => {
    const game = newGame(undefined);
    // Reaching maxPlayers arms the auto-start without setting startsAt.
    (game as any).hasReachedMaxPlayerCount = true;

    vi.advanceTimersByTime(60_000);

    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("does not start a full lobby everyone left, and prunes it", () => {
    const manager = new GameManager(mockLogger);
    const game = manager.createGame(
      "testgame",
      testGameConfig({ gameType: GameType.Private }),
    )!;
    (game as any).hasReachedMaxPlayerCount = true;
    // The clients who filled the lobby were pinging until the moment they
    // left, so the reap in phase() holds off while that clock is still warm.
    (game as any).lastPingUpdate = Date.now();

    vi.advanceTimersByTime(5_000);

    // Started with an empty roster, this would emit a playerless
    // match_started and run turns for nobody.
    expect(game.hasStarted()).toBe(false);
    expect(manager.activeGames()).toBe(1);

    // Once the ping clock goes quiet it is pruned instead.
    vi.advanceTimersByTime(30_000);

    expect(game.hasStarted()).toBe(false);
    expect(manager.activeGames()).toBe(0);
  });
});
