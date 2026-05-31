import { describe, expect, it } from "vitest";
import {
  ClientMessageSchema,
  GameInfoSchema,
  MapVoteIntentSchema,
  MapVotesSchema,
  PublicGameInfoSchema,
} from "../src/core/Schemas";

describe("MapVoteIntentSchema", () => {
  it("accepts up, down and clear votes", () => {
    for (const vote of ["up", "down", "clear"]) {
      expect(
        MapVoteIntentSchema.safeParse({ type: "map_vote", vote }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown vote values", () => {
    expect(
      MapVoteIntentSchema.safeParse({ type: "map_vote", vote: "sideways" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing vote field", () => {
    expect(MapVoteIntentSchema.safeParse({ type: "map_vote" }).success).toBe(
      false,
    );
  });

  it("round-trips as an intent client message", () => {
    const result = ClientMessageSchema.safeParse({
      type: "intent",
      intent: { type: "map_vote", vote: "up" },
    });
    expect(result.success).toBe(true);
  });
});

describe("MapVotesSchema", () => {
  it("accepts a counts-only tally", () => {
    expect(MapVotesSchema.safeParse({ up: 3, down: 1 }).success).toBe(true);
  });

  it("accepts an optional myVote, including null", () => {
    expect(
      MapVotesSchema.safeParse({ up: 0, down: 0, myVote: "down" }).success,
    ).toBe(true);
    expect(
      MapVotesSchema.safeParse({ up: 0, down: 0, myVote: null }).success,
    ).toBe(true);
  });

  it("rejects negative or non-integer counts", () => {
    expect(MapVotesSchema.safeParse({ up: -1, down: 0 }).success).toBe(false);
    expect(MapVotesSchema.safeParse({ up: 1.5, down: 0 }).success).toBe(false);
  });

  it("rejects an invalid myVote", () => {
    expect(
      MapVotesSchema.safeParse({ up: 0, down: 0, myVote: "clear" }).success,
    ).toBe(false);
  });
});

describe("lobby info schemas accept optional mapVotes", () => {
  it("GameInfoSchema parses with and without mapVotes", () => {
    const base = { gameID: "abc", serverTime: 123 };
    expect(GameInfoSchema.safeParse(base).success).toBe(true);
    expect(
      GameInfoSchema.safeParse({
        ...base,
        mapVotes: { up: 2, down: 1, myVote: "up" },
      }).success,
    ).toBe(true);
  });

  it("PublicGameInfoSchema parses with and without mapVotes", () => {
    const base = { gameID: "abc", numClients: 0, publicGameType: "ffa" };
    expect(PublicGameInfoSchema.safeParse(base).success).toBe(true);
    expect(
      PublicGameInfoSchema.safeParse({ ...base, mapVotes: { up: 5, down: 0 } })
        .success,
    ).toBe(true);
  });
});
