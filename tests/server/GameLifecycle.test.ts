import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GamePhase } from "../../src/server/GameServer";
import {
  makeClient,
  makeGame,
  mockLogger,
  startGame,
} from "../util/GameServerHarness";

describe("GameLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("should not start turn interval if game has ended", async () => {
    const game = makeGame();

    // Call end() first - this should set _hasEnded
    await game.end();

    // Now call start() - this should be a no-op due to our fix
    game.start();

    // No turn interval was armed.
    expect(vi.getTimerCount()).toBe(0);

    // Check if _hasStarted remained false (or at least no interval was created)
    expect(game.hasStarted()).toBe(false);
  });

  it("should clear turn interval and mark the game ended on end()", async () => {
    const game = makeGame();

    // Take the game through the real lobby -> game transition.
    startGame(game);
    // start() arms the turn interval (nobody joined, so no lobby broadcast).
    expect(vi.getTimerCount()).toBe(1);

    // end() should clear it
    await game.end();
    expect(vi.getTimerCount()).toBe(0);
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("does not try to archive a game that ends during prestart", async () => {
    // gameStartInfo only exists once start() has run; before that there is
    // no record to build, let alone upload.
    const log = mockLogger();
    const archive = vi.fn(async () => {});
    const game = makeGame({ log, deps: { archive } });
    game.joinClient(makeClient());
    game.prestart();

    await expect(game.end()).resolves.toBeUndefined();

    expect(archive).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      "game not started, not archiving game",
    );
    // The lobby-info broadcast the join armed is gone too.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores prestart() once the game has ended", async () => {
    // start() already refuses an ended game; prestart() must too, or an
    // ended lobby could change stage and go fetch tribes after shutdown.
    const fetchTribes = vi.fn(async () => []);
    const game = makeGame({
      config: { gameType: GameType.Public, bots: 1 },
      deps: { fetchTribes },
    });
    await game.end();
    game.prestart();
    expect(game.hasStarted()).toBe(false);
    expect(fetchTribes).not.toHaveBeenCalled();
  });

  it("should be resilient to multiple end() calls", async () => {
    const game = makeGame();

    await game.end();
    expect(game.phase()).toBe(GamePhase.Finished);

    // Should not throw or crash
    await expect(game.end()).resolves.toBeUndefined();
    expect(game.phase()).toBe(GamePhase.Finished);
  });
});
