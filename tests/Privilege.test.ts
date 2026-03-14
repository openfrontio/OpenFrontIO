import {
  createMatcher,
  PrivilegeCheckerImpl,
  shadowNames,
} from "../src/server/Privilege";

const bannedWords = [
  "hitler",
  "adolf",
  "nazi",
  "jew",
  "auschwitz",
  "whitepower",
  "heil",
  "chair", // Test word to verify custom banned words work
];

const matcher = createMatcher(bannedWords);

// Create a minimal PrivilegeCheckerImpl for testing censor
const mockCosmetics = { patterns: {}, colorPalettes: {} };
const mockDecoder = () => new Uint8Array();
const checker = new PrivilegeCheckerImpl(
  mockCosmetics,
  mockDecoder,
  bannedWords,
);
const emptyChecker = new PrivilegeCheckerImpl(mockCosmetics, mockDecoder, []);

describe("UsernameCensor", () => {
  describe("isProfane (via matcher.hasMatch)", () => {
    test("detects exact banned words", () => {
      expect(matcher.hasMatch("hitler")).toBe(true);
      expect(matcher.hasMatch("nazi")).toBe(true);
      expect(matcher.hasMatch("auschwitz")).toBe(true);
    });

    test("detects custom banned words like 'chair'", () => {
      expect(matcher.hasMatch("chair")).toBe(true);
      expect(matcher.hasMatch("Chair")).toBe(true);
      expect(matcher.hasMatch("CHAIR")).toBe(true);
      expect(matcher.hasMatch("MyChairName")).toBe(true);
    });

    test("detects banned words case-insensitively", () => {
      expect(matcher.hasMatch("Hitler")).toBe(true);
      expect(matcher.hasMatch("NAZI")).toBe(true);
      expect(matcher.hasMatch("Adolf")).toBe(true);
    });

    test("detects banned words with leet speak", () => {
      expect(matcher.hasMatch("h1tl3r")).toBe(true);
      expect(matcher.hasMatch("4d0lf")).toBe(true);
      expect(matcher.hasMatch("n4z1")).toBe(true);
    });

    test("detects banned words with duplicated characters", () => {
      expect(matcher.hasMatch("hiiitler")).toBe(true);
      expect(matcher.hasMatch("naazzii")).toBe(true);
    });

    test("detects banned words with accented characters", () => {
      expect(matcher.hasMatch("Adölf")).toBe(true);
    });

    test("detects banned words as substrings", () => {
      expect(matcher.hasMatch("xhitlerx")).toBe(true);
      expect(matcher.hasMatch("IloveNazi")).toBe(true);
    });

    test("allows clean usernames", () => {
      expect(matcher.hasMatch("CoolPlayer")).toBe(false);
      expect(matcher.hasMatch("GameMaster")).toBe(false);
      expect(matcher.hasMatch("xXx_Sniper_xXx")).toBe(false);
    });
  });

  describe("censor", () => {
    test("returns clean usernames unchanged", () => {
      expect(checker.censor("CoolPlayer", null).username).toBe("CoolPlayer");
      expect(checker.censor("GameMaster", null).username).toBe("GameMaster");
    });

    test("replaces profane usernames with a shadow name", () => {
      const result = checker.censor("hitler", null);
      expect(shadowNames).toContain(result.username);
    });

    test("replaces leet speak profane usernames with a shadow name", () => {
      const result = checker.censor("h1tl3r", null);
      expect(shadowNames).toContain(result.username);
    });

    test("preserves clean clan tag when username is profane", () => {
      const result = checker.censor("hitler", "COOL");
      expect(result.clanTag).toBe("COOL");
      expect(shadowNames).toContain(result.username);
    });

    test("removes profane clan tag but keeps clean username", () => {
      const result = checker.censor("CoolPlayer", "NAZI");
      expect(result.username).toBe("CoolPlayer");
      expect(result.clanTag).toBeNull();
    });

    test("removes clan tag with leet speak profanity", () => {
      const result = checker.censor("CoolPlayer", "N4Z1");
      expect(result.username).toBe("CoolPlayer");
      expect(result.clanTag).toBeNull();
    });

    test("removes clan tag with uppercased banned word", () => {
      const result = checker.censor("CoolPlayer", "ADOLF");
      expect(result.username).toBe("CoolPlayer");
      expect(result.clanTag).toBeNull();
    });

    test("removes clan tag containing banned word substring", () => {
      const result = checker.censor("CoolPlayer", "JEWS");
      expect(result.username).toBe("CoolPlayer");
      expect(result.clanTag).toBeNull();
    });

    test("removes profane clan tag and censors profane username", () => {
      const result = checker.censor("hitler", "NAZI");
      expect(result.clanTag).toBeNull();
      expect(shadowNames).toContain(result.username);
    });

    test("removes leet speak profane clan tag and censors leet speak username", () => {
      const result = checker.censor("h1tl3r", "N4Z1");
      expect(result.clanTag).toBeNull();
      expect(shadowNames).toContain(result.username);
    });

    test("returns deterministic shadow name for same input", () => {
      const a = checker.censor("hitler", null);
      const b = checker.censor("hitler", null);
      expect(a.username).toBe(b.username);
    });

    test("handles username with no clan tag", () => {
      expect(checker.censor("NormalPlayer", null).username).toBe(
        "NormalPlayer",
      );
    });

    test("empty banned words list still catches englishDataset profanity", () => {
      expect(emptyChecker.censor("CoolPlayer", null).username).toBe(
        "CoolPlayer",
      );
      const result = emptyChecker.censor("fuck", null);
      expect(shadowNames).toContain(result.username);
    });
  });
});
