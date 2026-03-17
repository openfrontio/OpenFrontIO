import { describe, expect, it } from "vitest";
import { ClientMsgRateLimiter } from "../../src/server/ClientMsgRateLimiter";

const CLIENT_A = "clientA" as any;
const CLIENT_B = "clientB" as any;

const SMALL = 100;
const LARGE = 501; // over MAX_INTENT_BYTES

describe("ClientMsgRateLimiter", () => {
  describe("intent messages", () => {
    it("allows intents within limits", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
    });

    it("kicks on oversized intent", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", LARGE)).toBe("kick");
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
  });

  describe("winner messages", () => {
    it("allows first winner message", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "winner", 50000)).toBe("ok");
    });

    it("allows up to 3 winner messages", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "winner", 50000)).toBe("ok");
      expect(limiter.check(CLIENT_A, "winner", 50000)).toBe("ok");
      expect(limiter.check(CLIENT_A, "winner", 50000)).toBe("ok");
      expect(limiter.check(CLIENT_A, "winner", 50000)).toBe("kick");
    });

    it("winner does not consume intent rate limit", () => {
      const limiter = new ClientMsgRateLimiter();
      limiter.check(CLIENT_A, "winner", 50000);
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
    });
  });

  describe("other messages", () => {
    it("applies rate limiting to other message types", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 10; i++) {
        expect(limiter.check(CLIENT_A, "ping", 50)).toBe("ok");
      }
      expect(limiter.check(CLIENT_A, "ping", 50)).toBe("limit");
    });
  });
});
