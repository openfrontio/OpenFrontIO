import { describe, expect, it } from "vitest";
import { VoteRound } from "../../src/server/VoteTally";

describe("VoteRound", () => {
  it("returns null until a candidate has a strict majority of IPs", () => {
    const round = new VoteRound<string>();
    round.add("a", "a", "1.1.1.1");
    // 1 of 3 unique IPs -> no majority yet.
    expect(round.result(3)).toBeNull();
    round.add("a", "a", "2.2.2.2");
    // 2 of 3 -> majority (2 * 2 > 3).
    expect(round.result(3)).toEqual({ value: "a", votes: 2 });
  });

  it("counts each IP once per candidate", () => {
    const round = new VoteRound<string>();
    expect(round.add("a", "a", "1.1.1.1")).toBe(1);
    expect(round.add("a", "a", "1.1.1.1")).toBe(1);
    // Still a single IP, so no majority of a 3-IP electorate.
    expect(round.result(3)).toBeNull();
  });

  it("tallies competing candidates independently", () => {
    const round = new VoteRound<string>();
    round.add("a", "a", "1.1.1.1");
    round.add("b", "b", "2.2.2.2");
    round.add("a", "a", "3.3.3.3");
    // 'a' has 2 of 4 IPs, which is only half, not a strict majority (2 * 2 > 4 is false).
    expect(round.result(4)).toBeNull();
    round.add("a", "a", "4.4.4.4");
    // 'a' now has 3 of 4 IPs (3 * 2 > 4) -> majority.
    expect(round.result(4)).toEqual({ value: "a", votes: 3 });
  });

  it("rejects a tie (exactly half the electorate)", () => {
    const round = new VoteRound<string>();
    round.add("a", "a", "1.1.1.1");
    // 1 of 2 unique IPs is only half, not a strict majority - must not pass.
    // Otherwise, in a 1v1 game, one player could unilaterally declare
    // themselves the winner without the other player agreeing (#4136).
    expect(round.result(2)).toBeNull();
    round.add("a", "a", "2.2.2.2");
    // 2 of 2 -> unanimous, now a strict majority.
    expect(round.result(2)).toEqual({ value: "a", votes: 2 });
  });

  it("still resolves immediately for a lone remaining elector", () => {
    const round = new VoteRound<string>();
    round.add("a", "a", "1.1.1.1");
    // If the electorate has shrunk to 1 (e.g. the other player disconnected),
    // the sole remaining vote is a strict majority on its own.
    expect(round.result(1)).toEqual({ value: "a", votes: 1 });
  });
});
