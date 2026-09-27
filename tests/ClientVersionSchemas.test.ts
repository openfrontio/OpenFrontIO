import {
  ClientJoinMessageSchema,
  ClientMessageSchema,
  ClientRejoinMessageSchema,
  PublicLobbyMessageSchema,
  ServerErrorSchema,
  ServerMessageSchema,
} from "../src/core/Schemas";
import { zb } from "../zbin";

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

describe("gitCommit on version_mismatch errors", () => {
  const mismatch = {
    type: "error" as const,
    error: "version_mismatch",
    gitCommit: COMMIT,
  };

  test("error parses with and without gitCommit", () => {
    const withCommit = ServerErrorSchema.safeParse(mismatch);
    expect(withCommit.success).toBe(true);
    expect(withCommit.data?.gitCommit).toBe(COMMIT);
    expect(
      ServerErrorSchema.safeParse({ type: "error", error: "banned" }).success,
    ).toBe(true);
  });

  test("error rejects an oversized gitCommit", () => {
    expect(
      ServerErrorSchema.safeParse({ ...mismatch, gitCommit: "a".repeat(65) })
        .success,
    ).toBe(false);
  });

  test("error round-trips the binary wire with gitCommit", () => {
    const bytes = ServerMessageSchema.serialize(mismatch);
    expect(ServerMessageSchema.parseBytes(bytes)).toEqual(mismatch);
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

  test("full message parses with the deployment-active flag", () => {
    const full = { type: "full", serverTime: 123, games: {}, active: false };
    const parsed = PublicLobbyMessageSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "full") {
      expect(parsed.data.active).toBe(false);
    }
  });
});

describe("platform on join messages", () => {
  const join = { ...baseJoin, type: "join", gitCommit: COMMIT } as const;

  test("round-trips the binary wire", () => {
    const withPlatform = { ...join, platform: "crazygames" } as const;
    const bytes = ClientMessageSchema.serialize(withPlatform);
    expect(ClientMessageSchema.parseBytes(bytes)).toEqual(withPlatform);
  });

  test("rejects a platform outside the closed set", () => {
    expect(
      ClientJoinMessageSchema.safeParse({ ...join, platform: "itch" }).success,
    ).toBe(false);
  });

  // A tab left open across a deploy must still decode, or it gets a generic
  // invalid-message close instead of the version_mismatch refresh prompt.
  test("a join from a bundle predating the field still decodes", () => {
    // Every optional/nullable field set, so the stale header is at its widest.
    const stale = { ...join, cosmetics: {}, spectator: true };
    const staleShape = ClientJoinMessageSchema.omit({ platform: true }).shape;
    const bytes = zb.object(staleShape).serialize(stale);
    const current = zb.object(ClientJoinMessageSchema.shape);
    expect(current.parseBytes(bytes)).toEqual(stale);
  });
});
