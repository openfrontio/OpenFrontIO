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

// Create a minimal PrivilegeCheckerImpl for testing censor
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
      type: "flag" as const,
      name: "cool_flag",
      url: "https://example.com/cool.png",
      affiliateCode: null,
      product: { productId: "prod_1", priceId: "price_1", price: "$4.99" },
      priceSoft: undefined,
      priceHard: undefined,
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

    describe("clan tag censoring", () => {
      test("removes profane clan tag, keeps clean username", () => {
        expect(checker.censor("CoolPlayer", "NAZI").clanTag).toBeNull();
        expect(checker.censor("CoolPlayer", "ADOLF").clanTag).toBeNull();
        expect(checker.censor("CoolPlayer", "HEIL").clanTag).toBeNull();
      });

      test("removes clan tag that is a slur abbreviation", () => {
        expect(checker.censor("CoolPlayer", "NIG").clanTag).toBeNull();
        expect(checker.censor("CoolPlayer", "NIGG").clanTag).toBeNull();
      });

      test("removes clan tag containing full slur (≤5 chars)", () => {
        expect(checker.censor("CoolPlayer", "NIGGA").clanTag).toBeNull();
        expect(checker.censor("CoolPlayer", "CHINK").clanTag).toBeNull();
        expect(checker.censor("CoolPlayer", "SPIC").clanTag).toBeNull();
        expect(checker.censor("CoolPlayer", "KIKE").clanTag).toBeNull();
      });

      test("removes clan tag with leet speak profanity (≤5 chars)", () => {
        expect(checker.censor("CoolPlayer", "N4Z1").clanTag).toBeNull();
      });

      test("removes clan tag containing banned word as substring (≤5 chars)", () => {
        expect(checker.censor("CoolPlayer", "JEWS").clanTag).toBeNull();
        expect(checker.censor("CoolPlayer", "NAZI").clanTag).toBeNull();
      });

      test("removes [SS] clan tag", () => {
        expect(checker.censor("Player", "SS").clanTag).toBeNull();
        expect(checker.censor("Player", "ss").clanTag).toBeNull();
      });

      test("removes [KKK] clan tag", () => {
        expect(checker.censor("Player", "KKK").clanTag).toBeNull();
      });

      test("keeps clean clan tag when username is clean", () => {
        expect(checker.censor("Player", "COOL").clanTag).toBe("COOL");
        expect(checker.censor("Player", "PRO").clanTag).toBe("PRO");
      });

      test("keeps clean clan tag, censors profane username", () => {
        const result = checker.censor("nigger", "COOL");
        expect(result.clanTag).toBe("COOL");
        expect(shadowNames).toContain(result.username);
      });

      test("removes profane clan tag and censors profane username", () => {
        const result = checker.censor("hitler", "NAZI");
        expect(result.clanTag).toBeNull();
        expect(shadowNames).toContain(result.username);
      });

      test("removes profane clan tag and censors leet speak username", () => {
        const result = checker.censor("h1tl3r", "N4Z1");
        expect(result.clanTag).toBeNull();
        expect(shadowNames).toContain(result.username);
      });

      test("removes profane clan tag with slur, censors profane username", () => {
        const result = checker.censor("nigger", "NIG");
        expect(result.clanTag).toBeNull();
        expect(shadowNames).toContain(result.username);
      });

      describe("clan tag + username combined forms a slur", () => {
        test("censors when clan+name combined forms hitler", () => {
          const result = checker.censor("LER", "HIT");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms hitler (split differently)", () => {
          const result = checker.censor("TLER", "HI");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms adolf", () => {
          const result = checker.censor("OLF", "AD");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms nigger", () => {
          const result = checker.censor("ger", "NIG");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms nigger (clean parts)", () => {
          const result = checker.censor("gger", "NI");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors leet speak combined across clan and name", () => {
          const result = checker.censor("g3r", "N1G");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });
      });
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
