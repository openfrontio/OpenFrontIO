import { describe, expect, it } from "vitest";
import { UsernameSchema } from "../src/core/Schemas";
import {
  AccountUsernameSchema,
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

  it("leaves the wire schema able to read older records", () => {
    // UsernameSchema backs PlayerSchema, so it parses names already written
    // into archived GameRecords. Narrowing it doesn't rewrite them, it makes
    // them unparseable — which dead-ends replay links (JoinLobbyModal parses
    // before the gitCommit check that would fall back to the versioned shell)
    // and share previews. The form cap is enforced separately.
    const legacy = "a".repeat(MAX_USERNAME_LENGTH + 5);
    expect(UsernameSchema.safeParse(legacy).success).toBe(true);
    expect(validateUsername(legacy).isValid).toBe(false);
  });
});

describe("free-form username charset", () => {
  it("still refuses characters the form's own message excludes", () => {
    // The wire schema carries hyphens so account names stay representable;
    // that must not reach the name a player types for themselves, whose error
    // message names letters, numbers, spaces and underscores.
    expect(validateUsername("foo-bar").isValid).toBe(false);
    expect(UsernameSchema.safeParse("foo-bar").success).toBe(true);
  });

  it("accepts what the message does name", () => {
    for (const name of ["foo bar", "foo_bar", "Foo1", "füÜ.bar"]) {
      expect(validateUsername(name).isValid).toBe(true);
    }
  });
});

describe("account names on the wire", () => {
  // Verified play submits the account name and skips free-form validation, so
  // anything AccountUsernameSchema accepts has to survive UsernameSchema or
  // the join is closed with 1002 after the UI has enabled Play.
  const names = [
    "cool-guy",
    "cool_guy",
    "Cool Guy",
    "cool-guy-2",
    "a-b_c d",
    "abc",
    "a".repeat(MAX_ACCOUNT_USERNAME_LENGTH),
  ];

  it.each(names)("accepts the account name %s", (name) => {
    expect(AccountUsernameSchema.safeParse(name).success).toBe(true);
    expect(UsernameSchema.safeParse(name).success).toBe(true);
    // The server-rendered display name carries a .dddd discriminator.
    expect(UsernameSchema.safeParse(`${name}.1234`).success).toBe(true);
  });
});
