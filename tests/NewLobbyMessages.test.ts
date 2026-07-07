import { describe, expect, it } from "vitest";
import { ClientMessageSchema, ServerMessageSchema } from "../src/core/Schemas";

// Wire messages that power reusing a private lobby for back-to-back games:
// the creator's "create_next_lobby" request and the server's "new_lobby"
// broadcast carrying the successor's id.
describe("reuse-lobby wire messages", () => {
  it("accepts a create_next_lobby client message", () => {
    const parsed = ClientMessageSchema.safeParse({ type: "create_next_lobby" });
    expect(parsed.success).toBe(true);
  });

  it("accepts a new_lobby server message with a valid game id", () => {
    const parsed = ServerMessageSchema.safeParse({
      type: "new_lobby",
      gameID: "abcd1234",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "new_lobby") {
      expect(parsed.data.gameID).toBe("abcd1234");
    }
  });

  it("rejects a new_lobby message without a game id", () => {
    const parsed = ServerMessageSchema.safeParse({ type: "new_lobby" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a new_lobby game id that is not a valid 8-char id", () => {
    const parsed = ServerMessageSchema.safeParse({
      type: "new_lobby",
      gameID: "not a valid id!",
    });
    expect(parsed.success).toBe(false);
  });
});
