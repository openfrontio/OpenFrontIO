import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { PartialGameRecord, Winner } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// Regression tests for game s5bcKtj8: in a 1v1 the loser disconnected within
// a second of being eliminated, before their client simulated the win tick
// and voted. The winner's vote sat at 1 of 2 active IPs and was never
// re-evaluated, so the game archived winnerless. The electorate shrinking
// must now trigger a re-tally.
//
// Driven through the real game: two players join and start, votes arrive as
// winner messages on their sockets, and the outcome is whatever record the
// game hands to the archive.
describe("winner vote re-tally when the electorate shrinks", () => {
  const WINNER = cid("winner");
  const LOSER = cid("loser");
  let archive: ReturnType<
    typeof vi.fn<(r: PartialGameRecord) => Promise<void>>
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    archive = vi.fn(async () => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function game1v1() {
    const game = makeGame({
      config: { gameType: GameType.Public },
      deps: { archive },
    });
    const winner = makeClient({ clientID: WINNER, ip: "1.1.1.1" });
    const loser = makeClient({ clientID: LOSER, ip: "2.2.2.2" });
    game.joinClient(winner);
    game.joinClient(loser);
    startGame(game);
    return { game, winner, loser };
  }

  const vote = (client: Client, winner: Winner) =>
    mockWsOf(client).emit({ type: "winner", winner, allPlayersStats: {} });
  const disconnect = (client: Client) => mockWsOf(client).trigger("close");
  // The winner in each record the game archived, in order.
  const archivedWinners = () =>
    archive.mock.calls.map(([record]) => record.info.winner);

  it("resolves a wedged 1v1 vote when the non-voting loser disconnects", async () => {
    const { winner, loser } = game1v1();
    await vote(winner, ["player", WINNER]);
    // 1 of 2 active IPs is not a strict majority: nothing archived yet.
    expect(archive).not.toHaveBeenCalled();

    await disconnect(loser);

    expect(archivedWinners()).toEqual([["player", WINNER]]);
  });

  it("does not crown a player who votes for themselves and disconnects", async () => {
    const { loser: cheater } = game1v1();
    await vote(cheater, ["player", LOSER]);
    await disconnect(cheater);
    // The departed cheater's vote must not count against the shrunken
    // electorate (#4136).
    expect(archive).not.toHaveBeenCalled();
  });

  it("stays winnerless when everyone leaves without any votes", async () => {
    const { winner, loser } = game1v1();
    await disconnect(loser);
    await disconnect(winner);
    expect(archive).not.toHaveBeenCalled();
  });

  it("does not archive a winner after the game already ended", async () => {
    const { game, winner, loser } = game1v1();
    await vote(winner, ["player", WINNER]);
    // Ending archives the game as it stands: winnerless.
    await game.end();
    expect(archivedWinners()).toEqual([undefined]);

    // The loser's socket closing afterwards must not re-tally and archive a
    // second, contradicting record.
    await disconnect(loser);
    expect(archivedWinners()).toEqual([undefined]);
  });

  it("re-tallies when the ping prune in phase() drops a stale client", async () => {
    const { game, winner, loser } = game1v1();
    await vote(winner, ["player", WINNER]);
    // The loser's connection dropped without a ws close event: pings stop,
    // and only the 60s prune in phase() removes them from activeClients.
    loser.lastPing = Date.now() - 61_000;
    game.phase();
    expect(archivedWinners()).toEqual([["player", WINNER]]);
  });
});
