import { describe, expect, it } from "vitest";
import { ClientSendWinnerMessage, LiveStats } from "../../src/core/Schemas";
import { LiveStatsVote, WinnerVote } from "../../src/server/Consensus";
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
