import { describe, expect, it } from "vitest";
import {
  AllPlayersStats,
  ClientSendWinnerMessage,
  LiveStats,
} from "../../src/core/Schemas";
import {
  createGameWireContext,
  decodeClientMessage,
  encodeClientMessage,
} from "../../src/core/ZbinWire";
import {
  LiveStatsVote,
  statsDigest,
  WinnerVote,
} from "../../src/server/Consensus";
import { cid } from "../util/GameServerHarness";

// The two vote objects on their own. Who may vote and what a settled vote
// triggers are GameServer's business, covered in WinnerVoteRetally.test.ts
// and LiveStats.test.ts.

const P1 = cid("p1");
const P2 = cid("p2");

const winnerMsg = (
  winner: ClientSendWinnerMessage["winner"],
): ClientSendWinnerMessage => ({ type: "winner", winner, allPlayersStats: {} });

describe("WinnerVote", () => {
  it("decides once a candidate holds a strict majority of the electorate", () => {
    const vote = new WinnerVote();
    expect(vote.cast(winnerMsg(["player", P1]), "1.1.1.1").votes).toBe(1);
    // 1 of 2 is a tie, not a majority.
    expect(vote.tally(2)).toBeNull();
    expect(vote.winner()).toBeNull();

    expect(vote.cast(winnerMsg(["player", P1]), "2.2.2.2").votes).toBe(2);
    expect(vote.tally(2)).toEqual({
      value: winnerMsg(["player", P1]),
      votes: 2,
    });
    expect(vote.winner()?.winner).toEqual(["player", P1]);
  });

  it("counts one vote per IP per candidate", () => {
    const vote = new WinnerVote();
    vote.cast(winnerMsg(["player", P1]), "1.1.1.1");
    expect(vote.cast(winnerMsg(["player", P1]), "1.1.1.1").votes).toBe(1);
    expect(vote.tally(2)).toBeNull();
  });

  it("keys a cancelled match (no winner) as null so those votes can agree", () => {
    const vote = new WinnerVote();
    expect(vote.cast(winnerMsg(undefined), "1.1.1.1").key).toBe("null");
    vote.cast(winnerMsg(undefined), "2.2.2.2");
    expect(vote.tally(2)?.value.winner).toBeUndefined();
  });

  it("re-tallies among the IPs still present, ignoring the departed", () => {
    const vote = new WinnerVote();
    vote.cast(winnerMsg(["player", P1]), "1.1.1.1");
    vote.cast(winnerMsg(["player", P2]), "2.2.2.2");
    expect(vote.tally(2)).toBeNull();

    // 2.2.2.2 left: their vote no longer counts, and the electorate is one.
    expect(vote.tallyAmong(new Set(["1.1.1.1"]))).toEqual({
      value: winnerMsg(["player", P1]),
      votes: 1,
    });
    expect(vote.winner()?.winner).toEqual(["player", P1]);
  });

  it("does not let a departed voter's own vote decide anything", () => {
    const vote = new WinnerVote();
    vote.cast(winnerMsg(["player", P2]), "2.2.2.2");
    expect(vote.tallyAmong(new Set(["1.1.1.1"]))).toBeNull();
    expect(vote.winner()).toBeNull();
  });
});

describe("statsDigest", () => {
  it("ignores key order at every level", () => {
    const a: AllPlayersStats = {
      [P1]: { gold: [1n, 2n], units: { city: [1n], port: [2n] } },
      [P2]: { killedAt: 10n },
    };
    const b: AllPlayersStats = {
      [P2]: { killedAt: 10n },
      [P1]: { units: { port: [2n], city: [1n] }, gold: [1n, 2n] },
    };
    expect(statsDigest(a)).toBe(statsDigest(b));
  });

  it("treats a bigint and its decimal string as the same value", () => {
    // The wire decodes stats to bigints; the archive writes them as strings.
    expect(statsDigest({ [P1]: { killedAt: 10n } })).toBe(
      statsDigest({ [P1]: { killedAt: "10" as unknown as bigint } }),
    );
  });

  it("changes when any value changes", () => {
    const base: AllPlayersStats = {
      [P1]: { deathPosition: 3, finalTiles: 100n },
    };
    expect(statsDigest(base)).not.toBe(
      statsDigest({ [P1]: { deathPosition: 2, finalTiles: 100n } }),
    );
    expect(statsDigest(base)).not.toBe(
      statsDigest({ [P1]: { deathPosition: 3, finalTiles: 101n } }),
    );
  });

  it("survives the binary wire the server receives votes over", () => {
    const stats: AllPlayersStats = {
      [P2]: {
        killedAt: 1200n,
        killedBy: P1,
        deathPosition: 2,
        units: { port: [1n, 0n, 1n], city: [3n] },
      },
      [P1]: {
        finalTiles: 5000n,
        kills: [{ victim: P2, tick: 1200n }],
        gold: [10n, 20n, 0n, 0n, 0n, 0n, 5n],
        killedBy: null,
      },
    };
    const msg: ClientSendWinnerMessage = {
      type: "winner",
      winner: ["player", P1],
      allPlayersStats: stats,
    };
    const players = [{ clientID: P1 }, { clientID: P2 }];
    const decoded = decodeClientMessage(
      encodeClientMessage(msg, createGameWireContext(players)),
      createGameWireContext(players),
    ) as ClientSendWinnerMessage;
    expect(statsDigest(decoded.allPlayersStats)).toBe(statsDigest(stats));
  });

  it("keeps array order significant", () => {
    expect(statsDigest({ [P1]: { gold: [1n, 2n] } })).not.toBe(
      statsDigest({ [P1]: { gold: [2n, 1n] } }),
    );
  });
});

describe("WinnerVote stats agreement", () => {
  const honest: AllPlayersStats = { [P1]: { finalTiles: 100n } };
  const forged: AllPlayersStats = { [P1]: { finalTiles: 999n } };
  const voteWith = (
    winner: ClientSendWinnerMessage["winner"],
    allPlayersStats: AllPlayersStats,
  ): ClientSendWinnerMessage => ({ type: "winner", winner, allPlayersStats });

  it("is null until the vote is decided", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], honest), "1.1.1.1");
    expect(vote.statsAgreement()).toBeNull();
  });

  it("reports one version when every voter sent the same stats", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], honest), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.tally(2);
    expect(vote.statsAgreement()).toEqual({
      voters: 2,
      versions: 1,
      archivedBackers: 2,
      topBackers: 2,
      agreed: true,
    });
  });

  it("reports a split where the majority's stats are archived", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], forged), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.cast(voteWith(["player", P1], honest), "3.3.3.3");
    vote.tally(3);
    expect(vote.statsAgreement()).toEqual({
      voters: 3,
      versions: 2,
      archivedBackers: 2,
      topBackers: 2,
      agreed: true,
    });
  });

  it("reports a split no version won", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], forged), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.tally(3);
    expect(vote.statsAgreement()).toEqual({
      voters: 2,
      versions: 2,
      archivedBackers: 1,
      topBackers: 1,
      agreed: false,
    });
  });

  it("counts only votes for the decided winner", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P2], forged), "9.9.9.9");
    vote.cast(voteWith(["player", P1], honest), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.tally(3);
    expect(vote.statsAgreement()).toEqual({
      voters: 2,
      versions: 1,
      archivedBackers: 2,
      topBackers: 2,
      agreed: true,
    });
  });
});

// Which stats the record carries. The winner is decided exactly as before;
// the stats are a second vote among that winner's voters, held to the same
// majority of the same electorate at the moment the winner is decided.
describe("WinnerVote archived stats", () => {
  const honest: AllPlayersStats = { [P1]: { finalTiles: 100n } };
  const forged: AllPlayersStats = { [P1]: { finalTiles: 999n } };
  const other: AllPlayersStats = { [P1]: { finalTiles: 5n } };
  const voteWith = (
    winner: ClientSendWinnerMessage["winner"],
    allPlayersStats: AllPlayersStats,
  ): ClientSendWinnerMessage => ({ type: "winner", winner, allPlayersStats });

  it("is null until the winner is decided", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], honest), "1.1.1.1");
    expect(vote.tally(2)).toBeNull();
    expect(vote.archivedStats()).toBeNull();
  });

  it("agrees when every voter sent the same stats", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], honest), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.cast(voteWith(["player", P1], honest), "3.3.3.3");
    vote.tally(3);
    expect(vote.archivedStats()).toEqual({ stats: honest, agreed: true });
  });

  it("agrees across key order, which differs between in-sync clients", () => {
    const vote = new WinnerVote();
    vote.cast(
      voteWith(["player", P1], { [P1]: { finalTiles: 1n }, [P2]: {} }),
      "1.1.1.1",
    );
    vote.cast(
      voteWith(["player", P1], { [P2]: {}, [P1]: { finalTiles: 1n } }),
      "2.2.2.2",
    );
    vote.tally(2);
    expect(vote.archivedStats()?.agreed).toBe(true);
  });

  it("archives the majority's stats, not the first voter's", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], forged), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.cast(voteWith(["player", P1], honest), "3.3.3.3");
    // The winner message is still the first vote, as before.
    expect(vote.tally(3)?.value.allPlayersStats).toEqual(forged);
    expect(vote.archivedStats()).toEqual({ stats: honest, agreed: true });
  });

  it("does not agree when no version holds a majority of the electorate", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], forged), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.cast(voteWith(["player", P1], honest), "3.3.3.3");
    vote.cast(voteWith(["player", P1], other), "4.4.4.4");
    vote.cast(voteWith(["player", P1], other), "5.5.5.5");
    // The winner has 5 of 6; no stats version has more than 2 of 6.
    const decided = vote.tally(6);
    expect(decided?.value.winner).toEqual(["player", P1]);
    expect(decided?.votes).toBe(5);
    // Not agreed, so the record falls back to the most-backed version, the
    // earliest of those on a tie.
    expect(vote.archivedStats()).toEqual({ stats: honest, agreed: false });
  });

  it("falls back to the first vote's stats on an even split", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], forged), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.tally(3);
    expect(vote.archivedStats()).toEqual({ stats: forged, agreed: false });
  });

  it("agrees with a lone voter, as the winner vote does", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], honest), "1.1.1.1");
    vote.tally(1);
    expect(vote.archivedStats()).toEqual({ stats: honest, agreed: true });
  });

  it("ignores stats sent with other winners", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P2], honest), "1.1.1.1");
    vote.cast(voteWith(["player", P1], forged), "2.2.2.2");
    vote.cast(voteWith(["player", P1], honest), "3.3.3.3");
    vote.cast(voteWith(["player", P1], honest), "4.4.4.4");
    vote.cast(voteWith(["player", P1], forged), "5.5.5.5");
    // P1 wins 4 of 5. `honest` was sent by 3 of 5 IPs, but only 2 of them
    // voted for P1, so neither version of P1's voters holds a majority.
    expect(vote.tally(5)?.value.winner).toEqual(["player", P1]);
    expect(vote.archivedStats()).toEqual({ stats: forged, agreed: false });
  });

  it("does not agree when shared IPs give two versions a majority", () => {
    const vote = new WinnerVote();
    // Two clients behind each IP, sending different stats.
    vote.cast(voteWith(["player", P1], forged), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "1.1.1.1");
    vote.cast(voteWith(["player", P1], forged), "2.2.2.2");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.tally(2);
    expect(vote.archivedStats()?.agreed).toBe(false);
  });

  it("counts a departed voter's stats only as far as their winner vote counts", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(["player", P1], forged), "1.1.1.1");
    vote.cast(voteWith(["player", P1], honest), "2.2.2.2");
    vote.cast(voteWith(["player", P1], honest), "3.3.3.3");
    // 1.1.1.1 left: among the two still present, the winner and the honest
    // stats both have 2 of 2.
    vote.tallyAmong(new Set(["2.2.2.2", "3.3.3.3"]));
    expect(vote.archivedStats()).toEqual({ stats: honest, agreed: true });

    const lone = new WinnerVote();
    lone.cast(voteWith(["player", P1], honest), "1.1.1.1");
    lone.cast(voteWith(["player", P1], forged), "2.2.2.2");
    // Only 2.2.2.2 remains: they alone decide the stats, as they do the
    // winner.
    lone.tallyAmong(new Set(["2.2.2.2"]));
    expect(lone.archivedStats()).toEqual({ stats: forged, agreed: true });
  });

  it("settles a cancelled match's stats the same way", () => {
    const vote = new WinnerVote();
    vote.cast(voteWith(undefined, honest), "1.1.1.1");
    vote.cast(voteWith(undefined, honest), "2.2.2.2");
    vote.tally(2);
    expect(vote.archivedStats()).toEqual({ stats: honest, agreed: true });
  });
});

describe("LiveStatsVote", () => {
  const stats = (turn: number, tilesOwned: number): LiveStats => ({
    turn,
    players: [
      {
        clientID: P1,
        tilesOwned,
        troops: 5,
        gold: "100",
        isAlive: true,
        team: null,
        killedBy: null,
        deathPosition: null,
      },
    ],
  });

  it("settles a turn at a strict majority of the electorate", () => {
    const vote = new LiveStatsVote();
    expect(vote.cast("c1", "1.1.1.1", stats(100, 10), 3)).toBe(false);
    expect(vote.latest()).toBeNull();
    expect(vote.cast("c2", "2.2.2.2", stats(100, 10), 3)).toBe(true);
    expect(vote.latest()).toEqual(stats(100, 10));
  });

  it("does not settle when the snapshots disagree", () => {
    const vote = new LiveStatsVote();
    vote.cast("c1", "1.1.1.1", stats(100, 10), 3);
    vote.cast("c2", "2.2.2.2", stats(100, 20), 3);
    expect(vote.cast("c3", "3.3.3.3", stats(100, 30), 3)).toBe(false);
    expect(vote.latest()).toBeNull();
  });

  it("takes one vote per client per turn", () => {
    const vote = new LiveStatsVote();
    vote.cast("c1", "1.1.1.1", stats(100, 10), 3);
    // The same client backing a different snapshot is ignored, so neither
    // candidate can reach a majority from this one client.
    expect(vote.cast("c1", "1.1.1.1", stats(100, 20), 3)).toBe(false);
    expect(vote.cast("c2", "2.2.2.2", stats(100, 20), 3)).toBe(false);
    expect(vote.latest()).toBeNull();
  });

  it("ignores turns at or before the latest settled one", () => {
    const vote = new LiveStatsVote();
    vote.cast("c1", "1.1.1.1", stats(100, 10), 3);
    vote.cast("c2", "2.2.2.2", stats(100, 10), 3);
    expect(vote.cast("c1", "1.1.1.1", stats(50, 99), 3)).toBe(false);
    expect(vote.cast("c2", "2.2.2.2", stats(50, 99), 3)).toBe(false);
    expect(vote.latest()?.turn).toBe(100);
  });

  it("advances to a newer turn once it settles", () => {
    const vote = new LiveStatsVote();
    vote.cast("c1", "1.1.1.1", stats(100, 10), 3);
    vote.cast("c2", "2.2.2.2", stats(100, 10), 3);
    vote.cast("c1", "1.1.1.1", stats(200, 42), 3);
    expect(vote.cast("c2", "2.2.2.2", stats(200, 42), 3)).toBe(true);
    expect(vote.latest()).toEqual(stats(200, 42));
  });

  it("drops the oldest pending turn once more than twenty are waiting", () => {
    const vote = new LiveStatsVote();
    // c1 alone cannot settle anything against an electorate of five...
    vote.cast("c1", "1.1.1.1", stats(0, 1), 5);
    // ...and twenty newer pending turns push turn 0 out of the window.
    for (let turn = 1; turn <= 20; turn++) {
      vote.cast("c1", "1.1.1.1", stats(turn, 1), 5);
    }
    // Turn 0's round is gone, so c1 is no longer a recorded voter for it and
    // a fresh vote is accepted; alone against an electorate of one it wins.
    expect(vote.cast("c1", "1.1.1.1", stats(0, 1), 1)).toBe(true);
    expect(vote.latest()?.turn).toBe(0);
  });

  it("keeps a pending turn that is still within the window", () => {
    const vote = new LiveStatsVote();
    vote.cast("c1", "1.1.1.1", stats(0, 1), 5);
    for (let turn = 1; turn <= 19; turn++) {
      vote.cast("c1", "1.1.1.1", stats(turn, 1), 5);
    }
    // Twenty pending in total: turn 0 is still there, so c1's repeat vote
    // for it is a duplicate and is ignored.
    expect(vote.cast("c1", "1.1.1.1", stats(0, 1), 1)).toBe(false);
    expect(vote.latest()).toBeNull();
  });
});
