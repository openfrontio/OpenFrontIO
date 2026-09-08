import { describe, expect, it } from "vitest";
import { GAME_ID_REGEX, ID, isValidGameID } from "../../src/core/Schemas";
import { generateID } from "../../src/core/Util";

// Game ids are permanent archive keys, so the accepted range must cover every
// id ever minted: the historical 8-char format and the upcoming 10-char
// multi-server format (instance letter + 9 random, docs/MultiServer.md).
describe("GAME_ID_REGEX", () => {
  it.each(["AbCd1234", "AbCd12345", "AbCd123456"])(
    "accepts %s (8–10 alphanumeric chars)",
    (id) => {
      expect(GAME_ID_REGEX.test(id)).toBe(true);
      expect(isValidGameID(id)).toBe(true);
      expect(ID.safeParse(id).success).toBe(true);
    },
  );

  it.each([
    "AbCd123", // 7 chars: too short
    "AbCd1234567", // 11 chars: too long
    "", // empty
    "AbCd 234", // space
    "AbCd-234", // punctuation
    "AbCd123\n", // trailing newline (regex must be anchored)
  ])("rejects %j", (id) => {
    expect(GAME_ID_REGEX.test(id)).toBe(false);
    expect(isValidGameID(id)).toBe(false);
    expect(ID.safeParse(id).success).toBe(false);
  });

  // Minting is unchanged in this PR: the widened range only ships validation
  // ahead of the 10-char format, so old bundles have soaked before any longer
  // id exists.
  it("generateID still mints 8-char ids that match the regex", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateID();
      expect(id).toHaveLength(8);
      expect(GAME_ID_REGEX.test(id)).toBe(true);
    }
  });
});
