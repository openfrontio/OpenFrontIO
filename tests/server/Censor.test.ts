import { describe, expect, test } from "vitest";
import {
  censorPlayer,
  profanityMatcher,
  shadowNames,
} from "../../src/server/Censor";

describe("Censor (local fallback)", () => {
  describe("profanityMatcher", () => {
    test("detects exact banned words", () => {
      expect(profanityMatcher.hasMatch("hitler")).toBe(true);
      expect(profanityMatcher.hasMatch("nazi")).toBe(true);
      expect(profanityMatcher.hasMatch("auschwitz")).toBe(true);
      expect(profanityMatcher.hasMatch("nigger")).toBe(true);
      expect(profanityMatcher.hasMatch("nigga")).toBe(true);
      expect(profanityMatcher.hasMatch("chink")).toBe(true);
      expect(profanityMatcher.hasMatch("spic")).toBe(true);
      expect(profanityMatcher.hasMatch("kike")).toBe(true);
      expect(profanityMatcher.hasMatch("faggot")).toBe(true);
      expect(profanityMatcher.hasMatch("retard")).toBe(true);
    });

    test("detects banned words case-insensitively", () => {
      expect(profanityMatcher.hasMatch("Hitler")).toBe(true);
      expect(profanityMatcher.hasMatch("NAZI")).toBe(true);
      expect(profanityMatcher.hasMatch("Adolf")).toBe(true);
      expect(profanityMatcher.hasMatch("NIGGER")).toBe(true);
      expect(profanityMatcher.hasMatch("Nigga")).toBe(true);
      expect(profanityMatcher.hasMatch("FAGGOT")).toBe(true);
      expect(profanityMatcher.hasMatch("Retard")).toBe(true);
    });

    test("detects banned words with leet speak", () => {
      expect(profanityMatcher.hasMatch("h1tl3r")).toBe(true);
      expect(profanityMatcher.hasMatch("4d0lf")).toBe(true);
      expect(profanityMatcher.hasMatch("n4z1")).toBe(true);
      expect(profanityMatcher.hasMatch("n1gg3r")).toBe(true);
      expect(profanityMatcher.hasMatch("f4gg0t")).toBe(true);
      expect(profanityMatcher.hasMatch("r3t4rd")).toBe(true);
    });

    test("detects banned words with duplicated characters", () => {
      expect(profanityMatcher.hasMatch("hiiitler")).toBe(true);
      expect(profanityMatcher.hasMatch("naazzii")).toBe(true);
      expect(profanityMatcher.hasMatch("niiiigger")).toBe(true);
      expect(profanityMatcher.hasMatch("faaggot")).toBe(true);
    });

    test("detects banned words with accented/confusable characters", () => {
      expect(profanityMatcher.hasMatch("Adölf")).toBe(true);
      expect(profanityMatcher.hasMatch("nïgger")).toBe(true);
    });

    test("detects banned words as substrings", () => {
      expect(profanityMatcher.hasMatch("xhitlerx")).toBe(true);
      expect(profanityMatcher.hasMatch("IloveNazi")).toBe(true);
      // Regression: slur + suffix / prefix must be caught
      expect(profanityMatcher.hasMatch("niggertesting")).toBe(true);
      expect(profanityMatcher.hasMatch("testingnigger")).toBe(true);
      expect(profanityMatcher.hasMatch("xnazix")).toBe(true);
      expect(profanityMatcher.hasMatch("faggotry")).toBe(true);
      expect(profanityMatcher.hasMatch("retarded")).toBe(true);
    });

    test("detects banned words with non-alphabetic characters mixed in", () => {
      expect(profanityMatcher.hasMatch("n.i.g.g.e.r")).toBe(true);
      expect(profanityMatcher.hasMatch("hi_tler")).toBe(true);
    });

    test("allows clean usernames", () => {
      expect(profanityMatcher.hasMatch("CoolPlayer")).toBe(false);
      expect(profanityMatcher.hasMatch("GameMaster")).toBe(false);
      expect(profanityMatcher.hasMatch("xXx_Sniper_xXx")).toBe(false);
      expect(profanityMatcher.hasMatch("ProGamer123")).toBe(false);
      expect(profanityMatcher.hasMatch("NightOwl")).toBe(false);
      expect(profanityMatcher.hasMatch("DragonSlayer")).toBe(false);
    });

    test("does not false-positive on words containing banned substrings legitimately", () => {
      // "snigger" is whitelisted in englishDataset
      expect(profanityMatcher.hasMatch("snigger")).toBe(false);
    });

    test("catches kkk as substring", () => {
      expect(profanityMatcher.hasMatch("kkk")).toBe(true);
      expect(profanityMatcher.hasMatch("KKK")).toBe(true);
      expect(profanityMatcher.hasMatch("kkklover")).toBe(true);
      expect(profanityMatcher.hasMatch("ilovekkkboys")).toBe(true);
    });

    test("catches slurs separated by periods (bypass attempt)", () => {
      expect(profanityMatcher.hasMatch("n.i.g.g.e.r")).toBe(true);
      expect(profanityMatcher.hasMatch("N.I.G.G.E.R")).toBe(true);
      expect(profanityMatcher.hasMatch("n.i.g.g.a")).toBe(true);
      expect(profanityMatcher.hasMatch("h.i.t.l.e.r")).toBe(true);
      expect(profanityMatcher.hasMatch("hello n.i.g.g.e.r world")).toBe(true);
    });

    test("censorPlayer replaces period-separated slur usernames", () => {
      const result = censorPlayer("n.i.g.g.e.r", null);
      expect(shadowNames).toContain(result.username);
    });
  });

  describe("censorPlayer", () => {
    test("returns clean usernames unchanged", () => {
      expect(censorPlayer("CoolPlayer", null).username).toBe("CoolPlayer");
      expect(censorPlayer("GameMaster", null).username).toBe("GameMaster");
    });

    test("replaces profane usernames with a shadow name", () => {
      const result = censorPlayer("hitler", null);
      expect(shadowNames).toContain(result.username);
    });

    test("replaces leet speak profane usernames with a shadow name", () => {
      const result = censorPlayer("h1tl3r", null);
      expect(shadowNames).toContain(result.username);
    });

    test("preserves clean clan tag when username is profane", () => {
      const result = censorPlayer("hitler", "COOL");
      expect(result.clanTag).toBe("COOL");
      expect(shadowNames).toContain(result.username);
    });

    describe("clan tag censoring", () => {
      test("removes profane clan tag, keeps clean username", () => {
        expect(censorPlayer("CoolPlayer", "NAZI").clanTag).toBeNull();
        expect(censorPlayer("CoolPlayer", "ADOLF").clanTag).toBeNull();
        expect(censorPlayer("CoolPlayer", "HEIL").clanTag).toBeNull();
      });

      test("removes clan tag that is a slur abbreviation", () => {
        expect(censorPlayer("CoolPlayer", "NIG").clanTag).toBeNull();
        expect(censorPlayer("CoolPlayer", "NIGG").clanTag).toBeNull();
      });

      test("removes clan tag containing full slur (≤5 chars)", () => {
        expect(censorPlayer("CoolPlayer", "NIGGA").clanTag).toBeNull();
        expect(censorPlayer("CoolPlayer", "CHINK").clanTag).toBeNull();
        expect(censorPlayer("CoolPlayer", "SPIC").clanTag).toBeNull();
        expect(censorPlayer("CoolPlayer", "KIKE").clanTag).toBeNull();
      });

      test("removes clan tag with leet speak profanity (≤5 chars)", () => {
        expect(censorPlayer("CoolPlayer", "N4Z1").clanTag).toBeNull();
      });

      test("removes clan tag containing banned word as substring (≤5 chars)", () => {
        expect(censorPlayer("CoolPlayer", "NAZIS").clanTag).toBeNull();
        expect(censorPlayer("CoolPlayer", "HEILS").clanTag).toBeNull();
      });

      test("removes [SS] clan tag", () => {
        expect(censorPlayer("Player", "SS").clanTag).toBeNull();
        expect(censorPlayer("Player", "ss").clanTag).toBeNull();
      });

      test("removes [KKK] clan tag", () => {
        expect(censorPlayer("Player", "KKK").clanTag).toBeNull();
      });

      test("keeps clean clan tag when username is clean", () => {
        expect(censorPlayer("Player", "COOL").clanTag).toBe("COOL");
        expect(censorPlayer("Player", "PRO").clanTag).toBe("PRO");
      });

      test("keeps clean clan tag, censors profane username", () => {
        const result = censorPlayer("nigger", "COOL");
        expect(result.clanTag).toBe("COOL");
        expect(shadowNames).toContain(result.username);
      });

      test("removes profane clan tag and censors profane username", () => {
        const result = censorPlayer("hitler", "NAZI");
        expect(result.clanTag).toBeNull();
        expect(shadowNames).toContain(result.username);
      });

      test("removes profane clan tag and censors leet speak username", () => {
        const result = censorPlayer("h1tl3r", "N4Z1");
        expect(result.clanTag).toBeNull();
        expect(shadowNames).toContain(result.username);
      });

      test("removes profane clan tag with slur, censors profane username", () => {
        const result = censorPlayer("nigger", "NIG");
        expect(result.clanTag).toBeNull();
        expect(shadowNames).toContain(result.username);
      });

      describe("clan tag + username combined forms a slur", () => {
        test("censors when clan+name combined forms hitler", () => {
          const result = censorPlayer("LER", "HIT");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms hitler (split differently)", () => {
          const result = censorPlayer("TLER", "HI");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms adolf", () => {
          const result = censorPlayer("OLF", "AD");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms nigger", () => {
          const result = censorPlayer("ger", "NIG");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors when clan+name combined forms nigger (clean parts)", () => {
          const result = censorPlayer("gger", "NI");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });

        test("censors leet speak combined across clan and name", () => {
          const result = censorPlayer("g3r", "N1G");
          expect(shadowNames).toContain(result.username);
          expect(result.clanTag).toBeNull();
        });
      });
    });

    test("returns deterministic shadow name for same input", () => {
      const a = censorPlayer("hitler", null);
      const b = censorPlayer("hitler", null);
      expect(a.username).toBe(b.username);
    });

    test("handles username with no clan tag", () => {
      expect(censorPlayer("NormalPlayer", null).username).toBe("NormalPlayer");
    });

    test("catches englishDataset profanity beyond the static banned words", () => {
      const result = censorPlayer("fuck", null);
      expect(shadowNames).toContain(result.username);
    });
  });
});
