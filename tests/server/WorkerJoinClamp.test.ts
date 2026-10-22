import { MAX_USERNAME_LENGTH } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import type { JoinVerifyResponse } from "../../src/server/JoinVerify";
import {
  AdmissionTarget,
  clampApprovedUsername,
  createAdmissionGuard,
  isSocketClosed,
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

  it("passes structured errorCodes through on rejection in resolveJoinVerdict", () => {
    const verdict: JoinVerifyResponse = {
      status: "rejected",
      reason: "duplicate",
      errorCodes: ["timeout-or-duplicate"],
    };
    const outcome = resolveJoinVerdict(verdict, {
      username: "user",
      clanTag: null,
    });
    expect(outcome).toEqual({
      action: "reject",
      reason: "duplicate",
      errorCodes: ["timeout-or-duplicate"],
    });
  });

  it("passes legacy rejection without errorCodes through in resolveJoinVerdict", () => {
    const verdict: JoinVerifyResponse = {
      status: "rejected",
      reason: "invalid_token",
    };
    const outcome = resolveJoinVerdict(verdict, {
      username: "user",
      clanTag: null,
    });
    expect(outcome).toEqual({
      action: "reject",
      reason: "invalid_token",
    });
  });

  it("detects socket closed and closing states with isSocketClosed", () => {
    expect(isSocketClosed({ readyState: 0 })).toBe(false); // CONNECTING
    expect(isSocketClosed({ readyState: 1 })).toBe(false); // OPEN
    expect(isSocketClosed({ readyState: 2 })).toBe(true); // CLOSING
    expect(isSocketClosed({ readyState: 3 })).toBe(true); // CLOSED
  });
});

describe("createAdmissionGuard", () => {
  function makeMockTarget(initialAdmitted: string[] = []): AdmissionTarget {
    const admitted = new Set<string>(initialAdmitted);
    return {
      markAdmitted(pid: string) {
        admitted.add(pid);
      },
      unmarkAdmitted(pid: string) {
        admitted.delete(pid);
      },
      wasAdmitted(pid: string) {
        return admitted.has(pid);
      },
    };
  }

  it("tentatively admits a new join and unmarks it on rollback", () => {
    const target = makeMockTarget();
    const pid = "new-user";
    const guard = createAdmissionGuard(target, pid, false);

    expect(target.wasAdmitted(pid)).toBe(false);
    expect(guard.wasAdmittedThisAttempt()).toBe(false);

    guard.markAdmittedIfNeeded();
    expect(target.wasAdmitted(pid)).toBe(true);
    expect(guard.wasAdmittedThisAttempt()).toBe(true);

    guard.rollback();
    expect(target.wasAdmitted(pid)).toBe(false);
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
  });

  it("preserves prior admission when isReadmit is true and rollback is a no-op", () => {
    const target = makeMockTarget(["returning-user"]);
    const pid = "returning-user";
    const guard = createAdmissionGuard(target, pid, true);

    expect(target.wasAdmitted(pid)).toBe(true);
    expect(guard.wasAdmittedThisAttempt()).toBe(false);

    guard.markAdmittedIfNeeded();
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
    expect(target.wasAdmitted(pid)).toBe(true);

    guard.rollback();
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
    expect(target.wasAdmitted(pid)).toBe(true);
  });

  it("preserves concurrent admission when wasAdmitted becomes true before markAdmittedIfNeeded", () => {
    const target = makeMockTarget();
    const pid = "concurrent-user";
    const guard = createAdmissionGuard(target, pid, false);

    target.markAdmitted(pid);
    expect(target.wasAdmitted(pid)).toBe(true);

    guard.markAdmittedIfNeeded();
    expect(guard.wasAdmittedThisAttempt()).toBe(false);

    guard.rollback();
    expect(target.wasAdmitted(pid)).toBe(true);
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
  });

  it("handles undefined game target safely", () => {
    const guard = createAdmissionGuard(undefined, "unknown-game-pid", false);
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
    expect(() => guard.markAdmittedIfNeeded()).not.toThrow();
    expect(guard.wasAdmittedThisAttempt()).toBe(true);
    expect(() => guard.rollback()).not.toThrow();
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
  });

  it("handles null game target safely (e.g. from gm.game() miss)", () => {
    const guard = createAdmissionGuard(null, "unknown-game-pid", false);
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
    expect(() => guard.markAdmittedIfNeeded()).not.toThrow();
    expect(guard.wasAdmittedThisAttempt()).toBe(true);
    expect(() => guard.rollback()).not.toThrow();
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
  });

  it("is idempotent on duplicate markAdmittedIfNeeded and repeated rollback", () => {
    const target = makeMockTarget();
    const pid = "idempotent-user";
    const guard = createAdmissionGuard(target, pid, false);

    guard.markAdmittedIfNeeded();
    expect(guard.wasAdmittedThisAttempt()).toBe(true);
    expect(target.wasAdmitted(pid)).toBe(true);

    // Second call is idempotent
    guard.markAdmittedIfNeeded();
    expect(guard.wasAdmittedThisAttempt()).toBe(true);
    expect(target.wasAdmitted(pid)).toBe(true);

    guard.rollback();
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
    expect(target.wasAdmitted(pid)).toBe(false);

    // Repeated rollback is a safe no-op
    guard.rollback();
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
    expect(target.wasAdmitted(pid)).toBe(false);
  });

  it("does not rollback if markAdmittedIfNeeded was never called", () => {
    const target = makeMockTarget();
    const pid = "never-marked";
    const guard = createAdmissionGuard(target, pid, false);

    guard.rollback();
    expect(target.wasAdmitted(pid)).toBe(false);
    expect(guard.wasAdmittedThisAttempt()).toBe(false);
  });
});
