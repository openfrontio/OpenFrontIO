import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameType, RankedType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GamePhase, GameServer } from "../../src/server/GameServer";

function makeMockWs() {
  return {
    on: () => {},
    removeAllListeners: () => {},
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  };
}

function makeClient(clientID: string, persistentID: string): Client {
  return new Client(
    clientID,
    persistentID,
    null,
    null,
    undefined,
    "127.0.0.1",
    "TestUser",
    null,
    makeMockWs() as any,
    undefined,
    `pub-${persistentID}`,
    [],
  );
}

describe("GameServer - short-handed matchmade game cancellation", () => {
  let mockLogger: any;

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
    vi.useRealTimers();
  });

  function makeRankedGame(rankedType: RankedType, maxPlayers: number) {
    return new GameServer(
      "test-game",
      mockLogger,
      Date.now(),
      { gameType: GameType.Public, rankedType, maxPlayers } as any,
      undefined,
      Date.now() + 15000,
    );
  }

  it("cancels a 2v2 game missing a player: kicks the connected, ends the game", () => {
    const game = makeRankedGame(RankedType.TwoVTwo, 4);
    const clients = [
      makeClient("c1", "p1"),
      makeClient("c2", "p2"),
      makeClient("c3", "p3"),
    ];
    clients.forEach((c) => expect(game.joinClient(c)).toBe("joined"));

    expect(game.cancelShortHandedMatch()).toBe(true);

    for (const c of clients) {
      expect(c.ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "error",
          error: "kick_reason.match_cancelled",
        }),
      );
      expect(c.ws.close).toHaveBeenCalled();
    }
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("cancels a 1v1 game where the opponent never connected", () => {
    const game = makeRankedGame(RankedType.OneVOne, 2);
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(true);
    expect(game.phase()).toBe(GamePhase.Finished);
  });

  it("does not cancel a ranked game with full attendance", () => {
    const game = makeRankedGame(RankedType.OneVOne, 2);
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");
    expect(game.joinClient(makeClient("c2", "p2"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(false);
    expect(game.phase()).not.toBe(GamePhase.Finished);
  });

  it("does not cancel unknown ranked types — new modes must opt in", () => {
    const game = new GameServer(
      "test-game",
      mockLogger,
      Date.now(),
      { gameType: GameType.Public, rankedType: "3v3", maxPlayers: 6 } as any,
      undefined,
      Date.now() + 15000,
    );
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(false);
  });

  it("does not cancel non-ranked games, even short-handed", () => {
    const game = new GameServer(
      "test-game",
      mockLogger,
      Date.now(),
      { gameType: GameType.Public, maxPlayers: 4 } as any,
      undefined,
      Date.now() + 15000,
    );
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(false);
  });
});
