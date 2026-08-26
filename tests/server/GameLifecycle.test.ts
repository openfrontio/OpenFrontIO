import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamePhase } from "../../src/server/GameServer";
import { makeGame, startGame } from "../util/GameServerHarness";

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

  it("should be resilient to multiple end() calls", async () => {
    const game = makeGame();

    await game.end();
    expect(game.phase()).toBe(GamePhase.Finished);

    // Should not throw or crash
    await expect(game.end()).resolves.toBeUndefined();
    expect(game.phase()).toBe(GamePhase.Finished);
  });
});
