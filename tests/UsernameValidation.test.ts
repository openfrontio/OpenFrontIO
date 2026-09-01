import { describe, expect, it } from "vitest";
import { CHAR_RANGE } from "../src/client/render/gl/passes/name-pass/Types";
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
  it("accepts what the message names", () => {
    for (const name of [
      "foo bar",
      "foo_bar",
      "Foo1",
      "füÜ.bar",
      // Hyphens are typeable now: the persona sanitiser keeps them, so a form
      // that rejected them would seed a name its own field refuses.
      "foo-bar",
    ]) {
      expect(validateUsername(name).isValid, name).toBe(true);
    }
  });

  it("accepts the accented names the renderer can already draw", () => {
    // The MSDF atlas covers Latin Extended-A, so these have glyphs and were
    // rejected anyway — sending José and Müller to a generated guest name.
    for (const name of ["José", "Müller", "Łukasz", "Renée", "Bjørn", "Ægir"]) {
      expect(validateUsername(name).isValid, name).toBe(true);
      expect(UsernameSchema.safeParse(name).success, name).toBe(true);
    }
  });

  it("still refuses what the renderer cannot draw", () => {
    // Emoji render as a separate icon beside the name, never inline, so an
    // emoji in the name itself has no glyph at all. Beyond Latin Extended-A
    // there is no atlas coverage.
    for (const name of ["🔥Ada", "日本語", "Пётр", "aƀc", "ｄａｒｋ"]) {
      expect(validateUsername(name).isValid, name).toBe(false);
      expect(UsernameSchema.safeParse(name).success, name).toBe(false);
    }
  });

  it("refuses punctuation and symbols inside the atlas range", () => {
    // Widening to "everything under U+0180" would have admitted control
    // characters, the C1 block and HTML-significant punctuation. It is letters
    // and digits plus a named punctuation allowlist, not a codepoint bound.
    for (const name of [
      "a<b>c",
      "a/b/c",
      "a@bc",
      "a:bc",
      "a¡bc",
      "a×bc",
      "a÷bc",
      "a\u0000bc",
      "a\u0080bc",
    ]) {
      expect(validateUsername(name).isValid, JSON.stringify(name)).toBe(false);
      expect(UsernameSchema.safeParse(name).success, JSON.stringify(name)).toBe(
        false,
      );
    }
  });

  it("tracks the renderer's atlas range", () => {
    // The charset exists to match what the name renderer can draw. If the
    // atlas grows or shrinks and the charset doesn't follow, either names get
    // rejected for glyphs we have or accepted for glyphs we don't.
    const inRange = String.fromCodePoint(CHAR_RANGE - 1); // U+017F, ſ
    const outOfRange = String.fromCodePoint(CHAR_RANGE); // U+0180, ƀ
    expect(UsernameSchema.safeParse(`ab${inRange}`).success).toBe(true);
    expect(UsernameSchema.safeParse(`ab${outOfRange}`).success).toBe(false);
  });

  it("keeps the wire schema a superset of the form", () => {
    // The form rule may narrow; the wire schema may only widen. A free-form
    // name the field accepts but the wire rejects closes the join with 1002
    // after Play has been enabled.
    for (const name of [
      "foo bar",
      "foo-bar",
      "foo_bar",
      "foo.bar",
      "José",
      "Łukasz",
      "a".repeat(MAX_USERNAME_LENGTH),
    ]) {
      expect(validateUsername(name).isValid, name).toBe(true);
      expect(UsernameSchema.safeParse(name).success, name).toBe(true);
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
