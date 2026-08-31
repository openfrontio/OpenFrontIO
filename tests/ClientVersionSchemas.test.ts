import {
  ClientJoinMessageSchema,
  ClientRejoinMessageSchema,
  PublicLobbyMessageSchema,
} from "../src/core/Schemas";

const COMMIT = "a".repeat(40);

const baseJoin = {
  type: "join",
  token: "123e4567-e89b-12d3-a456-426614174000",
  gameID: "abcd1234",
  username: "TestPlayer",
  clanTag: null,
  turnstileToken: null,
};

const baseRejoin = {
  type: "rejoin",
  gameID: "abcd1234",
  lastTurn: 10,
  token: "123e4567-e89b-12d3-a456-426614174000",
};

describe("gitCommit on join/rejoin messages", () => {
  test("join parses with gitCommit", () => {
    const result = ClientJoinMessageSchema.safeParse({
      ...baseJoin,
      gitCommit: COMMIT,
    });
    expect(result.success).toBe(true);
    expect(result.data?.gitCommit).toBe(COMMIT);
  });

  test("join parses without gitCommit (pre-feature clients)", () => {
    const result = ClientJoinMessageSchema.safeParse(baseJoin);
    expect(result.success).toBe(true);
    expect(result.data?.gitCommit).toBeUndefined();
  });

  test("join rejects an oversized gitCommit", () => {
    const result = ClientJoinMessageSchema.safeParse({
      ...baseJoin,
      gitCommit: "a".repeat(65),
    });
    expect(result.success).toBe(false);
  });

  test("rejoin parses with and without gitCommit", () => {
    expect(
      ClientRejoinMessageSchema.safeParse({ ...baseRejoin, gitCommit: COMMIT })
        .success,
    ).toBe(true);
    expect(ClientRejoinMessageSchema.safeParse(baseRejoin).success).toBe(true);
  });
});

describe("gitCommit on the public lobby feed", () => {
  test("full message parses with and without gitCommit", () => {
    const full = { type: "full", serverTime: 123, games: {} };
    expect(PublicLobbyMessageSchema.safeParse(full).success).toBe(true);
    const withCommit = PublicLobbyMessageSchema.safeParse({
      ...full,
      gitCommit: COMMIT,
    });
    expect(withCommit.success).toBe(true);
    if (withCommit.success && withCommit.data.type === "full") {
      expect(withCommit.data.gitCommit).toBe(COMMIT);
    }
  });
});
