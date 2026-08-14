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

  it("carries the same bound on the wire schema", () => {
    // UsernameSchema duplicates the bounds because it can't import them
    // (validations/username.ts imports the schema). The server validates
    // every join against it, so the two drifting apart would let a name
    // through the form that the server then refuses.
    expect(
      UsernameSchema.safeParse("a".repeat(MAX_USERNAME_LENGTH)).success,
    ).toBe(true);
    expect(
      UsernameSchema.safeParse("a".repeat(MAX_USERNAME_LENGTH + 1)).success,
    ).toBe(false);
    expect(
      UsernameSchema.safeParse("a".repeat(MIN_USERNAME_LENGTH)).success,
    ).toBe(true);
    expect(
      UsernameSchema.safeParse("a".repeat(MIN_USERNAME_LENGTH - 1)).success,
    ).toBe(false);
  });
});
