import { MAX_USERNAME_LENGTH } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import type { JoinVerifyResponse } from "../../src/server/JoinVerify";
import {
  clampApprovedUsername,
  resolveJoinVerdict,
} from "../../src/server/Worker";
import { cid, makeClient, makeGame } from "../util/GameServerHarness";

describe("Worker join username clamping", () => {
  it("clamps an approved 21-character username in join verdict and stores 20 characters in GameServer", () => {
    const verdict: JoinVerifyResponse = {
      status: "approved",
      username: "a".repeat(21),
      clanTag: "TAG",
    };
    const outcome = resolveJoinVerdict(verdict, {
      username: "fallback",
      clanTag: null,
    });
    expect(outcome.action).toBe("admit");
    if (outcome.action === "admit") {
      expect(outcome.username).toHaveLength(MAX_USERNAME_LENGTH);
      expect(outcome.username).toBe("a".repeat(MAX_USERNAME_LENGTH));
      expect(outcome.clanTag).toBe("TAG");

      const client = makeClient({
        clientID: cid("cappr"),
        username: outcome.username,
      });
      const game = makeGame();
      expect(game.joinClient(client)).toBe("joined");
      const stored = game
        .gameInfo()
        .clients?.find((c) => c.clientID === client.clientID);
      expect(stored?.username).toBe("a".repeat(MAX_USERNAME_LENGTH));
      expect(stored?.username).toHaveLength(20);
    }
  });

  it("exercises the join_verify error/fallback path with an overlong identity username and stores clamped username in GameServer", () => {
    const verdict: JoinVerifyResponse = {
      status: "error",
      reason: "name_check_timeout",
      degraded: true,
      identity: {
        username: "x".repeat(25),
        clanTag: "CLAN",
      },
    };
    const outcome = resolveJoinVerdict(verdict, {
      username: "fallback_user",
      clanTag: null,
    });
    expect(outcome.action).toBe("admit");
    if (outcome.action === "admit") {
      expect(outcome.username).toHaveLength(MAX_USERNAME_LENGTH);
      expect(outcome.username).toBe("x".repeat(MAX_USERNAME_LENGTH));
      expect(outcome.clanTag).toBe("CLAN");

      const client = makeClient({
        clientID: cid("cerr"),
        username: outcome.username,
      });
      const game = makeGame();
      expect(game.joinClient(client)).toBe("joined");
      const stored = game
        .gameInfo()
        .clients?.find((c) => c.clientID === client.clientID);
      expect(stored?.username).toBe("x".repeat(MAX_USERNAME_LENGTH));
      expect(stored?.username).toHaveLength(20);
    }
  });

  it("leaves an approved username within the limit untouched", () => {
    const valid = "player_one";
    expect(clampApprovedUsername(valid)).toBe(valid);
  });

  it("trims trailing whitespace when clamped", () => {
    const withSpace = "a".repeat(MAX_USERNAME_LENGTH - 1) + " bcd";
    const clamped = clampApprovedUsername(withSpace);
    expect(clamped).toBe("a".repeat(MAX_USERNAME_LENGTH - 1));
    expect(clamped.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
  });

  it("clamps an overlong identity username from error/fallback verdict directly", () => {
    const errorIdentityUsername = "x".repeat(25);
    const clamped = clampApprovedUsername(errorIdentityUsername);
    expect(clamped).toHaveLength(MAX_USERNAME_LENGTH);
    expect(clamped).toBe("x".repeat(MAX_USERNAME_LENGTH));
  });
});
