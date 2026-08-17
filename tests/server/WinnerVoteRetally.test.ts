import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GameServer } from "../../src/server/GameServer";

// Regression tests for game s5bcKtj8: in a 1v1 the loser disconnected within
// a second of being eliminated, before their client simulated the win tick
// and voted. The winner's vote sat at 1 of 2 active IPs and was never
// re-evaluated, so the game archived winnerless. The electorate shrinking
// must now trigger a re-tally.
describe("winner vote re-tally when the electorate shrinks", () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  function makeClient(clientID: string, ip: string) {
    return {
      clientID,
      ip,
      persistentID: `pid-${clientID}`,
      username: clientID,
      reportedWinner: null,
      hashes: new Map(),
      lastPing: Date.now(),
      ws: { readyState: 3, close: vi.fn(), OPEN: 1 },
    } as any;
  }

  function game1v1() {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Public,
    } as any);
    const winner = makeClient("client01", "1.1.1.1");
    const loser = makeClient("client02", "2.2.2.2");
    (game as any).activeClients = [winner, loser];
    (game as any).allClients = new Map([
      ["client01", winner],
      ["client02", loser],
    ]);
    (game as any)._hasStarted = true;
    (game as any).archiveGame = vi.fn();
    return { game, winner, loser };
  }

  const vote = (game: GameServer, client: any, winner: any) =>
    (game as any).handleWinner(client, {
      type: "winner",
      winner,
      allPlayersStats: {},
    });

  it("resolves a wedged 1v1 vote when the non-voting loser disconnects", () => {
    const { game, winner, loser } = game1v1();
    vote(game, winner, ["player", "client01"]);
    // 1 of 2 active IPs is not a strict majority: nothing archived yet.
    expect((game as any).winner).toBeNull();
    expect((game as any).archiveGame).not.toHaveBeenCalled();

    (game as any).handleClientDisconnect(loser);

    expect((game as any).winner?.winner).toEqual(["player", "client01"]);
    expect((game as any).archiveGame).toHaveBeenCalledTimes(1);
  });

  it("does not crown a player who votes for themselves and disconnects", () => {
    const { game, loser: cheater } = game1v1();
    vote(game, cheater, ["player", "client02"]);
    (game as any).handleClientDisconnect(cheater);
    // The departed cheater's vote must not count against the shrunken
    // electorate (#4136).
    expect((game as any).winner).toBeNull();
    expect((game as any).archiveGame).not.toHaveBeenCalled();
  });

  it("stays winnerless when everyone leaves without any votes", () => {
    const { game, winner, loser } = game1v1();
    (game as any).handleClientDisconnect(loser);
    (game as any).handleClientDisconnect(winner);
    expect((game as any).winner).toBeNull();
    expect((game as any).archiveGame).not.toHaveBeenCalled();
  });

  it("does not archive again after the game already ended", () => {
    const { game, winner, loser } = game1v1();
    vote(game, winner, ["player", "client01"]);
    (game as any)._hasEnded = true;
    (game as any).handleClientDisconnect(loser);
    expect((game as any).winner).toBeNull();
    expect((game as any).archiveGame).not.toHaveBeenCalled();
  });

  it("re-tallies when the ping prune in phase() drops a stale client", () => {
    const { game, winner, loser } = game1v1();
    vote(game, winner, ["player", "client01"]);
    // The loser's connection dropped without a ws close event: pings stop,
    // and only the 60s prune in phase() removes them from activeClients.
    loser.lastPing = Date.now() - 61_000;
    game.phase();
    expect((game as any).winner?.winner).toEqual(["player", "client01"]);
    expect((game as any).archiveGame).toHaveBeenCalledTimes(1);
  });
});
