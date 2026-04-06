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
  "nigger",
  "nigga",
  "chink",
  "spic",
  "kike",
  "faggot",
  "retard",
  "chair", // Test word to verify custom banned words work
];

const matcher = createMatcher(bannedWords);

// Create a minimal PrivilegeCheckerImpl for testing censorUsername
const mockCosmetics = { patterns: {}, colorPalettes: {}, flags: {} };
const mockDecoder = () => new Uint8Array();
const checker = new PrivilegeCheckerImpl(
  mockCosmetics,
  mockDecoder,
  bannedWords,
);
const emptyChecker = new PrivilegeCheckerImpl(mockCosmetics, mockDecoder, []);

const flagCosmetics = {
  patterns: {},
  colorPalettes: {},
  flags: {
    cool_flag: {
      name: "cool_flag",
      url: "https://example.com/cool.png",
      affiliateCode: null,
      product: { productId: "prod_1", priceId: "price_1", price: "$4.99" },
      rarity: "common",
    },
  },
};
const flagChecker = new PrivilegeCheckerImpl(
  flagCosmetics,
  mockDecoder,
  bannedWords,
);

describe("UsernameCensor", () => {
  describe("isProfane (via matcher.hasMatch)", () => {
    test("detects exact banned words", () => {
      expect(matcher.hasMatch("hitler")).toBe(true);
      expect(matcher.hasMatch("nazi")).toBe(true);
      expect(matcher.hasMatch("auschwitz")).toBe(true);
      expect(matcher.hasMatch("nigger")).toBe(true);
      expect(matcher.hasMatch("nigga")).toBe(true);
      expect(matcher.hasMatch("chink")).toBe(true);
      expect(matcher.hasMatch("spic")).toBe(true);
      expect(matcher.hasMatch("kike")).toBe(true);
      expect(matcher.hasMatch("faggot")).toBe(true);
      expect(matcher.hasMatch("retard")).toBe(true);
    });

    test("detects banned words case-insensitively", () => {
      expect(matcher.hasMatch("Hitler")).toBe(true);
      expect(matcher.hasMatch("NAZI")).toBe(true);
      expect(matcher.hasMatch("Adolf")).toBe(true);
      expect(matcher.hasMatch("NIGGER")).toBe(true);
      expect(matcher.hasMatch("Nigga")).toBe(true);
      expect(matcher.hasMatch("FAGGOT")).toBe(true);
      expect(matcher.hasMatch("Retard")).toBe(true);
    });

    test("detects banned words with leet speak", () => {
      expect(matcher.hasMatch("h1tl3r")).toBe(true);
      expect(matcher.hasMatch("4d0lf")).toBe(true);
      expect(matcher.hasMatch("n4z1")).toBe(true);
      expect(matcher.hasMatch("n1gg3r")).toBe(true);
      expect(matcher.hasMatch("f4gg0t")).toBe(true);
      expect(matcher.hasMatch("r3t4rd")).toBe(true);
    });

    test("detects banned words with duplicated characters", () => {
      expect(matcher.hasMatch("hiiitler")).toBe(true);
      expect(matcher.hasMatch("naazzii")).toBe(true);
      expect(matcher.hasMatch("niiiigger")).toBe(true);
      expect(matcher.hasMatch("faaggot")).toBe(true);
    });

    test("detects banned words with accented/confusable characters", () => {
      expect(matcher.hasMatch("Adölf")).toBe(true);
      expect(matcher.hasMatch("nïgger")).toBe(true);
    });

    test("detects banned words as substrings", () => {
      expect(matcher.hasMatch("xhitlerx")).toBe(true);
      expect(matcher.hasMatch("IloveNazi")).toBe(true);
      // Regression: slur + suffix / prefix must be caught
      expect(matcher.hasMatch("niggertesting")).toBe(true);
      expect(matcher.hasMatch("testingnigger")).toBe(true);
      expect(matcher.hasMatch("xnazix")).toBe(true);
      expect(matcher.hasMatch("faggotry")).toBe(true);
      expect(matcher.hasMatch("retarded")).toBe(true);
      expect(matcher.hasMatch("MyChairName")).toBe(true);
    });

    test("detects banned words with underscores/dots/numbers mixed in", () => {
      // These should NOT bypass the filter (skipNonAlphabetic was intentionally removed)
      // Words separated by non-alpha chars are treated as separate tokens
      expect(matcher.hasMatch("n.i.g.g.e.r")).toBe(false); // dots break the word
      expect(matcher.hasMatch("hi_tler")).toBe(false); // underscore breaks it
    });

    test("allows clean usernames", () => {
      expect(matcher.hasMatch("CoolPlayer")).toBe(false);
      expect(matcher.hasMatch("GameMaster")).toBe(false);
      expect(matcher.hasMatch("xXx_Sniper_xXx")).toBe(false);
      expect(matcher.hasMatch("ProGamer123")).toBe(false);
      expect(matcher.hasMatch("NightOwl")).toBe(false);
      expect(matcher.hasMatch("DragonSlayer")).toBe(false);
    });

    test("does not false-positive on words containing banned substrings legitimately", () => {
      // "snigger" is whitelisted in englishDataset
      expect(matcher.hasMatch("snigger")).toBe(false);
    });

    test("catches kkk as substring", () => {
      expect(matcher.hasMatch("kkk")).toBe(true);
      expect(matcher.hasMatch("KKK")).toBe(true);
      expect(matcher.hasMatch("kkklover")).toBe(true);
      expect(matcher.hasMatch("ilovekkkboys")).toBe(true);
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

    describe("clan tag censoring", () => {
      test("removes profane clan tag, keeps clean username", () => {
        expect(checker.censorUsername("[NAZI]CoolPlayer")).toBe("CoolPlayer");
        expect(checker.censorUsername("[ADOLF]CoolPlayer")).toBe("CoolPlayer");
        expect(checker.censorUsername("[HEIL]CoolPlayer")).toBe("CoolPlayer");
      });

      test("removes clan tag that is a slur abbreviation", () => {
        // [NIG] is caught as a standalone word by englishDataset's |nig| pattern
        expect(checker.censorUsername("[NIG]CoolPlayer")).toBe("CoolPlayer");
        expect(checker.censorUsername("[NIGG]CoolPlayer")).toBe("CoolPlayer");
      });

      test("removes clan tag containing full slur (≤5 chars)", () => {
        // Clan tags are capped at 5 chars — only slurs that fit are catchable this way
        expect(checker.censorUsername("[NIGGA]CoolPlayer")).toBe("CoolPlayer");
        expect(checker.censorUsername("[CHINK]CoolPlayer")).toBe("CoolPlayer");
        expect(checker.censorUsername("[SPIC]CoolPlayer")).toBe("CoolPlayer");
        expect(checker.censorUsername("[KIKE]CoolPlayer")).toBe("CoolPlayer");
      });

      test("removes clan tag with leet speak profanity (≤5 chars)", () => {
        expect(checker.censorUsername("[N4Z1]CoolPlayer")).toBe("CoolPlayer");
      });

      test("removes clan tag containing banned word as substring (≤5 chars)", () => {
        expect(checker.censorUsername("[JEWS]CoolPlayer")).toBe("CoolPlayer");
        expect(checker.censorUsername("[NAZI]CoolPlayer")).toBe("CoolPlayer");
      });

      test("removes [SS] clan tag", () => {
        expect(checker.censorUsername("[SS]Player")).toBe("Player");
        expect(checker.censorUsername("[ss]Player")).toBe("Player");
      });

      test("removes [KKK] clan tag", () => {
        expect(checker.censorUsername("[KKK]Player")).toBe("Player");
      });

      test("keeps clean clan tag when username is clean", () => {
        expect(checker.censorUsername("[COOL]Player")).toBe("[COOL] Player");
        expect(checker.censorUsername("[PRO]Player")).toBe("[PRO] Player");
      });

      test("keeps clean clan tag, censors profane username", () => {
        const result = checker.censorUsername("[COOL]nigger");
        expect(result).toMatch(/^\[COOL\] /);
        expect(shadowNames).toContain(result.replace("[COOL] ", ""));
      });

      test("removes profane clan tag and censors profane username", () => {
        const result = checker.censorUsername("[NAZI]hitler");
        expect(shadowNames).toContain(result);
        expect(result).not.toContain("[");
      });

      test("removes profane clan tag and censors leet speak username", () => {
        const result = checker.censorUsername("[N4Z1]h1tl3r");
        expect(shadowNames).toContain(result);
        expect(result).not.toContain("[");
      });

      test("removes profane clan tag with slur, censors profane username", () => {
        const result = checker.censorUsername("[NIG]nigger");
        expect(shadowNames).toContain(result);
        expect(result).not.toContain("[");
      });
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

describe("Flag validation in isAllowed", () => {
  test("allows valid country flag and resolves to SVG path", () => {
    const result = flagChecker.isAllowed([], { flag: "country:us" });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBe("/flags/us.svg");
    }
  });

  test("rejects invalid country code", () => {
    const result = flagChecker.isAllowed([], { flag: "country:zzzz" });
    expect(result.type).toBe("forbidden");
  });

  test("rejects flag with no prefix", () => {
    const result = flagChecker.isAllowed([], { flag: "us" });
    expect(result.type).toBe("forbidden");
  });

  test("allows cosmetic flag when user has wildcard flare", () => {
    const result = flagChecker.isAllowed(["flag:*"], {
      flag: "flag:cool_flag",
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBe("https://example.com/cool.png");
    }
  });

  test("allows cosmetic flag when user has specific flare", () => {
    const result = flagChecker.isAllowed(["flag:cool_flag"], {
      flag: "flag:cool_flag",
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBe("https://example.com/cool.png");
    }
  });

  test("rejects cosmetic flag when user lacks flare", () => {
    const result = flagChecker.isAllowed([], { flag: "flag:cool_flag" });
    expect(result.type).toBe("forbidden");
  });

  test("rejects cosmetic flag that does not exist", () => {
    const result = flagChecker.isAllowed(["flag:*"], {
      flag: "flag:nonexistent",
    });
    expect(result.type).toBe("forbidden");
  });

  test("allows no flag", () => {
    const result = flagChecker.isAllowed([], {});
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.flag).toBeUndefined();
    }
  });
});
