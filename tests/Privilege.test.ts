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

// Create a minimal PrivilegeCheckerImpl for testing censorUsername
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

  describe("censorUsername", () => {
    test("returns clean usernames unchanged", () => {
      expect(checker.censorUsername("CoolPlayer")).toBe("CoolPlayer");
      expect(checker.censorUsername("GameMaster")).toBe("GameMaster");
    });

    test("replaces profane usernames with a shadow name", () => {
      const result = checker.censorUsername("hitler");
      expect(shadowNames).toContain(result);
    });

    test("replaces leet speak profane usernames with a shadow name", () => {
      const result = checker.censorUsername("h1tl3r");
      expect(shadowNames).toContain(result);
    });

    test("preserves clean clan tag when username is profane", () => {
      const result = checker.censorUsername("[COOL]hitler");
      expect(result).toMatch(/^\[COOL\] /);
      const nameAfterTag = result.replace("[COOL] ", "");
      expect(shadowNames).toContain(nameAfterTag);
    });

    test("removes profane clan tag but keeps clean username", () => {
      expect(checker.censorUsername("[NAZI]CoolPlayer")).toBe("CoolPlayer");
    });

    test("removes clan tag with leet speak profanity", () => {
      expect(checker.censorUsername("[N4Z1]CoolPlayer")).toBe("CoolPlayer");
    });

    test("removes clan tag with uppercased banned word", () => {
      expect(checker.censorUsername("[ADOLF]CoolPlayer")).toBe("CoolPlayer");
    });

    test("removes clan tag containing banned word substring", () => {
      expect(checker.censorUsername("[JEWS]CoolPlayer")).toBe("CoolPlayer");
    });

    test("removes profane clan tag and censors profane username", () => {
      const result = checker.censorUsername("[NAZI]hitler");
      // No clan tag prefix, just a shadow name
      expect(shadowNames).toContain(result);
    });

    test("removes leet speak profane clan tag and censors leet speak username", () => {
      const result = checker.censorUsername("[N4Z1]h1tl3r");
      // No clan tag prefix, just a shadow name
      expect(shadowNames).toContain(result);
    });

    test("returns deterministic shadow name for same input", () => {
      const a = checker.censorUsername("hitler");
      const b = checker.censorUsername("hitler");
      expect(a).toBe(b);
    });

    test("handles username with no clan tag", () => {
      expect(checker.censorUsername("NormalPlayer")).toBe("NormalPlayer");
    });

    test("empty banned words list still catches englishDataset profanity", () => {
      // The emptyChecker still uses englishDataset, so common profanity is caught
      expect(emptyChecker.censorUsername("CoolPlayer")).toBe("CoolPlayer");
      // Verify a known english profanity gets censored even without custom banned words
      const result = emptyChecker.censorUsername("fuck");
      expect(shadowNames).toContain(result);
    });
  });
});
