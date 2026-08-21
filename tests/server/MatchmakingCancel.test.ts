import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameType, RankedType } from "../../src/core/game/Game";
import { Client } from "../../src/server/Client";
import { GamePhase, GameServer } from "../../src/server/GameServer";
import { sentServerMessages, testGameConfig } from "../util/Wire";

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
      testGameConfig({ gameType: GameType.Public, rankedType, maxPlayers }),
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
      expect(sentServerMessages(c.ws as any)).toContainEqual({
        type: "error",
        error: "kick_reason.match_cancelled",
      });
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
      testGameConfig({
        gameType: GameType.Public,
        rankedType: RankedType.TwoVTwo,
        maxPlayers: 6,
      }),
      undefined,
      Date.now() + 15000,
    );
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");
    // Swapped in after the join: an unknown ranked type can never reach a real
    // server (CreateGameInput validates it, and the binary wire only encodes
    // declared enum members), so this pokes the guard directly.
    (game as any).gameConfig.rankedType = "3v3";

    expect(game.cancelShortHandedMatch()).toBe(false);
  });

  it("does not cancel non-ranked games, even short-handed", () => {
    const game = new GameServer(
      "test-game",
      mockLogger,
      Date.now(),
      testGameConfig({ gameType: GameType.Public, maxPlayers: 4 }),
      undefined,
      Date.now() + 15000,
    );
    expect(game.joinClient(makeClient("c1", "p1"))).toBe("joined");

    expect(game.cancelShortHandedMatch()).toBe(false);
  });
});
