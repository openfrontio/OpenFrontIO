import { describe, expect, it } from "vitest";
import { UsernameSchema } from "../src/core/Schemas";
import {
  MAX_ACCOUNT_USERNAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  validateUsername,
} from "../src/core/validations/username";

describe("free-form username length", () => {
  it("matches the account-username cap", () => {
    expect(MAX_USERNAME_LENGTH).toBe(MAX_ACCOUNT_USERNAME_LENGTH);
  });

  it("accepts a name of exactly the maximum length", () => {
    expect(validateUsername("a".repeat(MAX_USERNAME_LENGTH)).isValid).toBe(
      true,
    );
  });

  it("rejects one character over", () => {
    const result = validateUsername("a".repeat(MAX_USERNAME_LENGTH + 1));
    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("still rejects names under the minimum", () => {
    expect(validateUsername("a".repeat(MIN_USERNAME_LENGTH - 1)).isValid).toBe(
      false,
    );
    expect(validateUsername("a".repeat(MIN_USERNAME_LENGTH)).isValid).toBe(
      true,
    );
  });

  it("keeps the wire schema tolerant of the names it used to accept", () => {
    // The server validates joins against this schema. Tightening it would
    // refuse a client that hasn't picked up the lower cap yet, so the cap is
    // enforced in validateUsername instead.
    const legacy = "a".repeat(MAX_USERNAME_LENGTH + 5);
    expect(UsernameSchema.safeParse(legacy).success).toBe(true);
    expect(validateUsername(legacy).isValid).toBe(false);
  });

  it("rejects a long name before its other problems", () => {
    // Length is checked first, so an over-long name reports length rather
    // than tripping the character rule.
    const result = validateUsername("!".repeat(MAX_USERNAME_LENGTH + 1));
    expect(result.isValid).toBe(false);
  });
});
