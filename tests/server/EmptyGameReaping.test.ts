import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/Schemas", async () => {
  const actual = (await vi.importActual("../../src/core/Schemas")) as any;
  return {
    ...actual,
    GameStartInfoSchema: {
      safeParse: (data: any) => ({ success: true, data: data }),
    },
    ServerPrestartMessageSchema: {
      safeParse: (data: any) => ({ success: true, data: data }),
    },
  };
});

import { GameType } from "../../src/core/game/Game";
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
      "test-game",
      mockLogger,
      Date.now(),
      testGameConfig({ gameType: GameType.Private }),
      undefined,
      startsAt,
    );

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

  it("finishes a full lobby everyone left before it started", () => {
    const game = newGame(undefined);
    // Reaching maxPlayers arms the auto-start without setting startsAt.
    (game as any).hasReachedMaxPlayerCount = true;

    vi.advanceTimersByTime(60_000);

    expect(game.phase()).toBe(GamePhase.Finished);
  });
});
