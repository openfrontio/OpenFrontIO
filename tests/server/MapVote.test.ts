import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GameServer } from "../../src/server/GameServer";

describe("GameServer map voting", () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  // A public lobby whose start time is in the future, so phase() === Lobby.
  function publicLobby(): GameServer {
    return new GameServer(
      "test-game",
      mockLogger,
      Date.now(),
      { gameType: GameType.Public, gameMap: "plains", gameMapSize: 100 } as any,
      undefined,
      Date.now() + 60_000,
      "ffa",
    );
  }

  it("records an upvote and surfaces it in gameInfo()", () => {
    const game = publicLobby();
    expect(game.applyMapVote("p1", "up")).toBe(true);
    expect(game.gameInfo().mapVotes).toEqual({ up: 1, down: 0 });
  });

  it("switches a vote instead of double counting", () => {
    const game = publicLobby();
    game.applyMapVote("p1", "up");
    game.applyMapVote("p1", "down");
    expect(game.gameInfo().mapVotes).toEqual({ up: 0, down: 1 });
  });

  it("clears a vote", () => {
    const game = publicLobby();
    game.applyMapVote("p1", "up");
    game.applyMapVote("p1", "clear");
    expect(game.gameInfo().mapVotes).toEqual({ up: 0, down: 0 });
  });

  it("counts one vote per distinct persistentID", () => {
    const game = publicLobby();
    game.applyMapVote("p1", "up");
    game.applyMapVote("p2", "up");
    game.applyMapVote("p3", "down");
    expect(game.gameInfo().mapVotes).toEqual({ up: 2, down: 1 });
  });

  it("does not surface mapVotes for private lobbies", () => {
    const game = new GameServer("private-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
      gameMap: "plains",
      gameMapSize: 100,
    } as any);
    expect(game.applyMapVote("p1", "up")).toBe(false);
    expect(game.gameInfo().mapVotes).toBeUndefined();
  });

  it("rejects votes once the lobby has started", () => {
    const game = publicLobby();
    // prestart() flips the lobby out of the waiting state.
    game.prestart();
    expect(game.applyMapVote("p1", "up")).toBe(false);
    expect(game.gameInfo().mapVotes).toEqual({ up: 0, down: 0 });
  });

  it("treats re-sending the same vote as a no-op", () => {
    const game = publicLobby();
    expect(game.applyMapVote("p1", "up")).toBe(true);
    expect(game.applyMapVote("p1", "up")).toBe(false);
    expect(game.applyMapVote("p1", "clear")).toBe(true);
    expect(game.applyMapVote("p1", "clear")).toBe(false);
  });

  it("drops a player's vote when they are kicked before start", () => {
    const game = publicLobby();
    const client = {
      clientID: "c1",
      persistentID: "p1",
      username: "u1",
      clanTag: null,
      friends: [],
      ws: { readyState: 1, send: () => {}, close: () => {} },
    } as any;
    (game as any).allClients.set("c1", client);
    (game as any).activeClients = [client];
    game.applyMapVote("p1", "up");
    expect(game.gameInfo().mapVotes).toEqual({ up: 1, down: 0 });
    game.kickClient("c1");
    expect(game.gameInfo().mapVotes).toEqual({ up: 0, down: 0 });
  });
});
