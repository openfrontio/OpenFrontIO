import { describe, expect, it } from "vitest";
import { VoteRound } from "../../src/server/VoteTally";

describe("VoteRound", () => {
  it("returns null until a candidate has a strict majority of IPs", () => {
    const round = new VoteRound<string>();
    round.add("a", "a", "1.1.1.1");
    // 1 of 3 unique IPs -> no majority yet.
    expect(round.result(3)).toBeNull();
    round.add("a", "a", "2.2.2.2");
    // 2 of 3 -> majority (2 * 2 >= 3).
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
    // 'a' has 2 of 4 IPs (2 * 2 >= 4), 'b' has 1.
    expect(round.result(4)).toEqual({ value: "a", votes: 2 });
  });

  it("accepts with exactly half the electorate (ties pass)", () => {
    const round = new VoteRound<string>();
    round.add("a", "a", "1.1.1.1");
    expect(round.result(2)).toEqual({ value: "a", votes: 1 });
  });
});
