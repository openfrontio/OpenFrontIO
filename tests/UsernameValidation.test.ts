import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { RENDERABLE_NAME_CHAR_RE, UsernameSchema } from "../src/core/Schemas";
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
    // Every Latin-1 Supplement letter has a real glyph in the atlas, so these
    // were being rejected for characters we can draw — sending José and
    // Müller to a generated guest name.
    for (const name of ["José", "Müller", "Renée", "Bjørn", "Ægir", "Iñigo"]) {
      expect(validateUsername(name).isValid, name).toBe(true);
      expect(UsernameSchema.safeParse(name).success, name).toBe(true);
    }
  });

  it("still refuses what the renderer cannot draw", () => {
    // Emoji render as a separate icon beside the name, never inline, so an
    // emoji in the name itself has no glyph at all. Latin Extended-A and above
    // is not drawable either — see the atlas/8-bit tests below.
    for (const name of [
      "🔥Ada",
      "日本語",
      "Пётр",
      "aƀc",
      "ｄａｒｋ",
      "Łukasz",
    ]) {
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

  // The charset exists to match what the name renderer can draw, so pin it to
  // the renderer rather than to a constant that merely looks like the limit.
  // `CHAR_RANGE = 384` sizes the metrics and kerning tables; it is an upper
  // bound on ids the atlas FILE may contain, not on what the string path can
  // carry. Pinning to it would admit 125 codepoints that render as tofu or as
  // the wrong letter entirely.
  describe("charset matches what the renderer can draw", () => {
    // Every codepoint the charset admits, expanded from the shared source.
    const admitted: number[] = [];
    for (let cp = 0; cp <= 0x2ff; cp++) {
      if (RENDERABLE_NAME_CHAR_RE.test(String.fromCodePoint(cp))) {
        admitted.push(cp);
      }
    }

    it("admits nothing the 8-bit string path would truncate", () => {
      // TextLayout writes charCodeAt into a Uint8Array and DataTextures
      // uploads it as R8UI, so anything above 255 wraps mod 256 — Ł (U+0141)
      // would draw as "A". There is no remapping step anywhere in the shader.
      expect(admitted.length).toBeGreaterThan(0);
      const tooHigh = admitted.filter((cp) => cp > 0xff);
      expect(tooHigh.map((cp) => cp.toString(16))).toEqual([]);
    });

    it("admits only letters the atlas has a real glyph for", () => {
      // index 0 is the font's .notdef box. All 64 Latin-1 Supplement entries
      // are real; only 3 of the 128 Latin Extended-A ones are.
      const atlas = JSON.parse(
        readFileSync("resources/atlases/msdf-atlas.json", "utf8"),
      ) as { chars: { id: number; index: number }[] };
      const real = new Set(
        atlas.chars.filter((c) => c.index !== 0).map((c) => c.id),
      );
      const missing = admitted.filter((cp) => !real.has(cp));
      expect(
        missing.map((cp) => `U+${cp.toString(16).padStart(4, "0")}`),
      ).toEqual([]);
    });

    it("still admits the accented Latin-1 letters, which do have glyphs", () => {
      for (const ch of "áéíóúàèìòùâêîôûäëïöüãñõçøåæýÿß") {
        expect(admitted, ch).toContain(ch.codePointAt(0));
      }
    });
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
      "Bjørn",
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
