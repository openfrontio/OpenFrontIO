import { describe, expect, it } from "vitest";
import { ClientMsgRateLimiter } from "../../src/server/ClientMsgRateLimiter";

const CLIENT_A = "clientA" as any;
const CLIENT_B = "clientB" as any;

const SMALL = 100;

describe("ClientMsgRateLimiter", () => {
  describe("intent messages", () => {
    it("allows intents within limits", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
    });

    it("limits when per-second count exceeded", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 10; i++) {
        expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
      }
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("limit");
    });

    it("rate limits are per client", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 10; i++) {
        limiter.check(CLIENT_A, "intent", SMALL);
      }
      expect(limiter.check(CLIENT_B, "intent", SMALL)).toBe("ok");
    });

    it("allows intents up to MAX_INTENT_SIZE", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", 2000)).toBe("ok");
    });

    it("kicks intents exceeding MAX_INTENT_SIZE", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", 2001)).toBe("kick");
    });
  });

  describe("per-intent-type limits", () => {
    it("limits a spammy social intent below the global limit", () => {
      const limiter = new ClientMsgRateLimiter();
      // quick_chat is capped at 4/sec, well under the global 10/sec.
      for (let i = 0; i < 4; i++) {
        expect(limiter.check(CLIENT_A, "intent", SMALL, "quick_chat")).toBe(
          "ok",
        );
      }
      expect(limiter.check(CLIENT_A, "intent", SMALL, "quick_chat")).toBe(
        "limit",
      );
    });

    it("a throttled type does not block other intent types", () => {
      const limiter = new ClientMsgRateLimiter();
      // Exhaust the quick_chat per-type bucket.
      for (let i = 0; i < 4; i++) {
        limiter.check(CLIENT_A, "intent", SMALL, "quick_chat");
      }
      expect(limiter.check(CLIENT_A, "intent", SMALL, "quick_chat")).toBe(
        "limit",
      );
      // A different intent type still has global budget left.
      expect(limiter.check(CLIENT_A, "intent", SMALL, "attack")).toBe("ok");
    });

    it("does not apply a per-type cap to unlisted intent types", () => {
      const limiter = new ClientMsgRateLimiter();
      // "attack" has no per-type cap, so only the global 10/sec applies.
      for (let i = 0; i < 10; i++) {
        expect(limiter.check(CLIENT_A, "intent", SMALL, "attack")).toBe("ok");
      }
      expect(limiter.check(CLIENT_A, "intent", SMALL, "attack")).toBe("limit");
    });

    it("per-type buckets are isolated per client", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 4; i++) {
        limiter.check(CLIENT_A, "intent", SMALL, "quick_chat");
      }
      expect(limiter.check(CLIENT_A, "intent", SMALL, "quick_chat")).toBe(
        "limit",
      );
      expect(limiter.check(CLIENT_B, "intent", SMALL, "quick_chat")).toBe("ok");
    });
  });

  describe("non-intent messages", () => {
    it("does not rate-limit non-intent messages", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 20; i++) {
        expect(limiter.check(CLIENT_A, "winner", 50)).toBe("ok");
      }
    });

    it("does not rate-limit ping messages", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 20; i++) {
        expect(limiter.check(CLIENT_A, "ping", 50)).toBe("ok");
      }
    });
  });

  describe("total bytes limit", () => {
    it("kicks when cumulative bytes reach 5MB", () => {
      const limiter = new ClientMsgRateLimiter();
      const chunkSize = 1024 * 1024; // 1MB
      // Send 4 chunks = 4MB, should be ok
      for (let i = 0; i < 4; i++) {
        expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("ok");
      }
      // 5th chunk pushes to 5MB, should kick
      expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("kick");
    });

    it("byte tracking is per client", () => {
      const limiter = new ClientMsgRateLimiter();
      const almostFull = 5 * 1024 * 1024 - 1;
      expect(limiter.check(CLIENT_A, "other", almostFull)).toBe("ok");
      // CLIENT_B should still be fine
      expect(limiter.check(CLIENT_B, "other", 100)).toBe("ok");
    });

    it("kicks on bytes regardless of message type", () => {
      const limiter = new ClientMsgRateLimiter();
      const twoMB = 2 * 1024 * 1024;
      expect(limiter.check(CLIENT_A, "intent", twoMB)).toBe("kick");
    });
  });
});
