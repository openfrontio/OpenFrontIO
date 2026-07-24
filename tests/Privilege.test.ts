import {
  enforceVerifiedBadge,
  FailOpenPrivilegeChecker,
  PrivilegeCheckerImpl,
} from "../src/server/Privilege";

const mockCosmetics = { patterns: {}, colorPalettes: {}, flags: {} };
const mockDecoder = () => new Uint8Array();
const checker = new PrivilegeCheckerImpl(mockCosmetics, mockDecoder);

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
const flagChecker = new PrivilegeCheckerImpl(flagCosmetics, mockDecoder);

const skinCosmetics = {
  patterns: {},
  colorPalettes: {},
  flags: {},
  skins: {
    mountain: {
      name: "mountain",
      url: "https://example.com/mountain.png",
      affiliateCode: null,
      product: { productId: "prod_1", priceId: "price_1", price: "$4.99" },
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "common",
    },
    forest: {
      name: "forest",
      url: "https://example.com/forest.png",
      affiliateCode: null,
      product: null,
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "rare",
    },
  },
};
const skinChecker = new PrivilegeCheckerImpl(skinCosmetics, mockDecoder);

const crownCosmetics = {
  patterns: {},
  colorPalettes: {},
  flags: {},
  crowns: {
    gold_crown: {
      name: "gold_crown",
      url: "https://example.com/gold.png",
      affiliateCode: null,
      product: null,
      priceSoft: undefined,
      priceHard: 5,
      rarity: "common",
    },
    silver_crown: {
      name: "silver_crown",
      url: "https://example.com/silver.png",
      affiliateCode: null,
      product: null,
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "rare",
    },
  },
};
const crownChecker = new PrivilegeCheckerImpl(crownCosmetics, mockDecoder);

const effectCosmetics = {
  patterns: {},
  colorPalettes: {},
  flags: {},
  effects: {
    // Each effect carries its effectType field (matching the outer key), as the
    // schema requires.
    transportShipTrail: {
      spectrum: {
        name: "spectrum",
        effectType: "transportShipTrail" as const,
        attributes: {
          type: "gradient" as const,
          colors: ["#ff0000", "#00ff00", "#0000ff"],
          colorSize: 16,
          movementSpeed: 0.15,
        },
        url: "",
        affiliateCode: null,
        product: null,
        priceSoft: undefined,
        priceHard: undefined,
        rarity: "legendary",
      },
      crimson: {
        name: "crimson",
        effectType: "transportShipTrail" as const,
        attributes: {
          type: "gradient" as const,
          colors: ["#e01b24"],
          colorSize: 16,
          movementSpeed: 0.15,
        },
        url: "",
        affiliateCode: null,
        product: { productId: "prod_1", priceId: "price_1", price: "$4.99" },
        priceSoft: undefined,
        priceHard: undefined,
        rarity: "common",
      },
    },
    nukeExplosion: {
      atom_boom: {
        name: "atom_boom",
        effectType: "nukeExplosion" as const,
        attributes: {
          type: "shockwave" as const,
          nukeType: "atom" as const,
          colors: ["#ff0000", "#7300ff"],
          size: 50,
          speed: 50,
          thickness: 4,
          transitionSpeed: 5,
        },
        url: "",
        affiliateCode: null,
        product: null,
        priceSoft: undefined,
        priceHard: undefined,
        rarity: "common",
      },
    },
  },
};
const effectChecker = new PrivilegeCheckerImpl(effectCosmetics, mockDecoder);

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

describe("Verified badge in isAllowed", () => {
  test("passes through a verified claim", () => {
    const result = flagChecker.isAllowed([], { verified: true });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.verified).toBe(true);
    }
  });

  test("stays unset when absent or false", () => {
    for (const refs of [{}, { verified: false }]) {
      const result = flagChecker.isAllowed([], refs);
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.verified).toBeUndefined();
      }
    }
  });
});

describe("enforceVerifiedBadge", () => {
  test("keeps the badge for an entitled player joining under their exact bare name", () => {
    for (const usernameStatus of ["premium", "indefinite"]) {
      const cosmetics = { verified: true };
      expect(
        enforceVerifiedBadge(cosmetics, "Bob", {
          username: "Bob",
          usernameStatus,
        }),
      ).toBe(false);
      expect(cosmetics.verified).toBe(true);
    }
  });

  test("strips on a case-different join name (exact match only)", () => {
    const cosmetics = { verified: true };
    expect(
      enforceVerifiedBadge(cosmetics, "bob", {
        username: "Bob",
        usernameStatus: "premium",
      }),
    ).toBe(true);
    expect(cosmetics.verified).toBeUndefined();
  });

  test("strips on a different name entirely", () => {
    const cosmetics = { verified: true };
    expect(
      enforceVerifiedBadge(cosmetics, "Alice", {
        username: "Bob",
        usernameStatus: "premium",
      }),
    ).toBe(true);
    expect(cosmetics.verified).toBeUndefined();
  });

  test("strips unentitled statuses even on an exact match", () => {
    for (const usernameStatus of ["unclaimed", "claimed", undefined]) {
      const cosmetics = { verified: true };
      expect(
        enforceVerifiedBadge(cosmetics, "Bob.4821", {
          username: "Bob.4821",
          usernameStatus,
        }),
      ).toBe(true);
      expect(cosmetics.verified).toBeUndefined();
    }
  });

  test("strips when the account has no username set", () => {
    for (const account of [
      { username: null, usernameStatus: "premium" },
      { usernameStatus: "premium" },
    ]) {
      const cosmetics = { verified: true };
      expect(enforceVerifiedBadge(cosmetics, "Bob", account)).toBe(true);
      expect(cosmetics.verified).toBeUndefined();
    }
  });

  test("keeps the badge on an anonymous join (null account, Dev-only)", () => {
    const cosmetics = { verified: true };
    expect(enforceVerifiedBadge(cosmetics, "Whatever", null)).toBe(false);
    expect(cosmetics.verified).toBe(true);
  });

  test("no-op without a claim", () => {
    for (const cosmetics of [{}, { verified: false }]) {
      expect(
        enforceVerifiedBadge(cosmetics, "Bob", {
          username: "Other",
          usernameStatus: "unclaimed",
        }),
      ).toBe(false);
    }
  });
});

describe("Skin validation", () => {
  describe("isSkinAllowed (direct)", () => {
    test("returns skin when user has wildcard flare", () => {
      const result = skinChecker.isSkinAllowed(["skin:*"], "mountain");
      expect(result).toEqual({
        name: "mountain",
        url: "https://example.com/mountain.png",
      });
    });

    test("returns skin when user has exact-match flare", () => {
      const result = skinChecker.isSkinAllowed(["skin:mountain"], "mountain");
      expect(result).toEqual({
        name: "mountain",
        url: "https://example.com/mountain.png",
      });
    });

    test("ignores unrelated flares", () => {
      expect(() =>
        skinChecker.isSkinAllowed(
          ["skin:forest", "pattern:*", "flag:*"],
          "mountain",
        ),
      ).toThrow(/No flares for skin mountain/);
    });

    test("throws when user has no skin flares", () => {
      expect(() => skinChecker.isSkinAllowed([], "mountain")).toThrow(
        /No flares for skin mountain/,
      );
    });

    test("throws when skin does not exist in cosmetics", () => {
      expect(() =>
        skinChecker.isSkinAllowed(["skin:*"], "nonexistent"),
      ).toThrow(/Skin nonexistent not found/);
    });

    test("throws when skin does not exist even with exact-match flare", () => {
      // Forged refs.skinName must not bypass the existence check.
      expect(() =>
        skinChecker.isSkinAllowed(["skin:nonexistent"], "nonexistent"),
      ).toThrow(/Skin nonexistent not found/);
    });

    test("throws when checker has no skins map at all", () => {
      // checker is constructed with mockCosmetics (no skins key).
      expect(() => checker.isSkinAllowed(["skin:*"], "anything")).toThrow(
        /Skin anything not found/,
      );
    });
  });

  describe("isAllowed integration", () => {
    test("allows valid skin with wildcard flare", () => {
      const result = skinChecker.isAllowed(["skin:*"], {
        skinName: "mountain",
      });
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.skin).toEqual({
          name: "mountain",
          url: "https://example.com/mountain.png",
        });
      }
    });

    test("allows valid skin with exact-match flare", () => {
      const result = skinChecker.isAllowed(["skin:forest"], {
        skinName: "forest",
      });
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.skin).toEqual({
          name: "forest",
          url: "https://example.com/forest.png",
        });
      }
    });

    test("rejects skin when user lacks flare", () => {
      const result = skinChecker.isAllowed([], { skinName: "mountain" });
      expect(result.type).toBe("forbidden");
      if (result.type === "forbidden") {
        expect(result.reason).toMatch(/invalid skin/);
      }
    });

    test("rejects skin when flare is for a different skin", () => {
      const result = skinChecker.isAllowed(["skin:forest"], {
        skinName: "mountain",
      });
      expect(result.type).toBe("forbidden");
    });

    test("rejects nonexistent skin", () => {
      const result = skinChecker.isAllowed(["skin:*"], {
        skinName: "ghost",
      });
      expect(result.type).toBe("forbidden");
      if (result.type === "forbidden") {
        expect(result.reason).toMatch(/Skin ghost not found/);
      }
    });

    test("no skin in refs leaves cosmetics.skin undefined", () => {
      const result = skinChecker.isAllowed(["skin:*"], {});
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.skin).toBeUndefined();
      }
    });

    test("invalid skin short-circuits and does not return other cosmetics", () => {
      // pattern is valid (no pattern requested), color is valid, skin is invalid —
      // the whole result must be forbidden, with no partial cosmetics leaking out.
      const result = skinChecker.isAllowed(["color:red"], {
        color: "red",
        skinName: "mountain",
      });
      expect(result.type).toBe("forbidden");
    });
  });
});

describe("Crown validation", () => {
  describe("isCrownAllowed (direct)", () => {
    test("returns crown when user has wildcard flare", () => {
      const result = crownChecker.isCrownAllowed(["crown:*"], "gold_crown");
      expect(result).toEqual({
        name: "gold_crown",
        url: "https://example.com/gold.png",
      });
    });

    test("returns crown when user has exact-match flare", () => {
      const result = crownChecker.isCrownAllowed(
        ["crown:gold_crown"],
        "gold_crown",
      );
      expect(result).toEqual({
        name: "gold_crown",
        url: "https://example.com/gold.png",
      });
    });

    test("ignores unrelated flares", () => {
      expect(() =>
        crownChecker.isCrownAllowed(
          ["crown:silver_crown", "skin:*", "flag:*"],
          "gold_crown",
        ),
      ).toThrow(/No flares for crown gold_crown/);
    });

    test("throws when user has no crown flares", () => {
      expect(() => crownChecker.isCrownAllowed([], "gold_crown")).toThrow(
        /No flares for crown gold_crown/,
      );
    });

    test("throws when crown does not exist in cosmetics", () => {
      expect(() =>
        crownChecker.isCrownAllowed(["crown:*"], "nonexistent"),
      ).toThrow(/Crown nonexistent not found/);
    });

    test("throws when crown does not exist even with exact-match flare", () => {
      // Forged refs.crownName must not bypass the existence check.
      expect(() =>
        crownChecker.isCrownAllowed(["crown:nonexistent"], "nonexistent"),
      ).toThrow(/Crown nonexistent not found/);
    });

    test("throws when checker has no crowns map at all", () => {
      // checker is constructed with mockCosmetics (no crowns key).
      expect(() => checker.isCrownAllowed(["crown:*"], "anything")).toThrow(
        /Crown anything not found/,
      );
    });
  });

  describe("isAllowed integration", () => {
    test("allows valid crown with wildcard flare", () => {
      const result = crownChecker.isAllowed(["crown:*"], {
        crownName: "gold_crown",
      });
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.crown).toEqual({
          name: "gold_crown",
          url: "https://example.com/gold.png",
        });
      }
    });

    test("allows valid crown with exact-match flare", () => {
      const result = crownChecker.isAllowed(["crown:silver_crown"], {
        crownName: "silver_crown",
      });
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.crown).toEqual({
          name: "silver_crown",
          url: "https://example.com/silver.png",
        });
      }
    });

    test("rejects crown when user lacks flare", () => {
      const result = crownChecker.isAllowed([], { crownName: "gold_crown" });
      expect(result.type).toBe("forbidden");
      if (result.type === "forbidden") {
        expect(result.reason).toMatch(/invalid crown/);
      }
    });

    test("rejects crown when flare is for a different crown", () => {
      const result = crownChecker.isAllowed(["crown:silver_crown"], {
        crownName: "gold_crown",
      });
      expect(result.type).toBe("forbidden");
    });

    test("rejects nonexistent crown", () => {
      const result = crownChecker.isAllowed(["crown:*"], {
        crownName: "ghost",
      });
      expect(result.type).toBe("forbidden");
      if (result.type === "forbidden") {
        expect(result.reason).toMatch(/Crown ghost not found/);
      }
    });

    test("no crown in refs leaves cosmetics.crown undefined", () => {
      const result = crownChecker.isAllowed(["crown:*"], {});
      expect(result.type).toBe("allowed");
      if (result.type === "allowed") {
        expect(result.cosmetics.crown).toBeUndefined();
      }
    });

    test("invalid crown short-circuits and does not return other cosmetics", () => {
      const result = crownChecker.isAllowed(["color:red"], {
        color: "red",
        crownName: "gold_crown",
      });
      expect(result.type).toBe("forbidden");
    });
  });
});

describe("Effect validation in isAllowed", () => {
  test("allows valid effect with wildcard flare", () => {
    const result = effectChecker.isAllowed(["effect:*"], {
      effects: { transportShipTrail: "spectrum" },
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.effects?.transportShipTrail).toEqual({
        name: "spectrum",
        effectType: "transportShipTrail",
      });
    }
  });

  test("allows valid effect with exact-match flare", () => {
    const result = effectChecker.isAllowed(["effect:crimson"], {
      effects: { transportShipTrail: "crimson" },
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.effects?.transportShipTrail).toEqual({
        name: "crimson",
        effectType: "transportShipTrail",
      });
    }
  });

  test("rejects effect when user lacks flare", () => {
    const result = effectChecker.isAllowed([], {
      effects: { transportShipTrail: "spectrum" },
    });
    expect(result.type).toBe("forbidden");
    if (result.type === "forbidden") {
      expect(result.reason).toMatch(/invalid effect/);
    }
  });

  test("allows a nuke-explosion effect in its matching nukeType slot", () => {
    const result = effectChecker.isAllowed(["effect:*"], {
      effects: { atom: "atom_boom" },
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.effects?.atom).toEqual({
        name: "atom_boom",
        effectType: "nukeExplosion",
      });
    }
  });

  test("rejects a nuke-explosion effect in a mismatched nukeType slot", () => {
    const result = effectChecker.isAllowed(["effect:*"], {
      effects: { hydro: "atom_boom" },
    });
    expect(result.type).toBe("forbidden");
    if (result.type === "forbidden") {
      expect(result.reason).toMatch(/not found for slot hydro/);
    }
  });

  test("rejects effect under an unknown effectType key", () => {
    const result = effectChecker.isAllowed(["effect:*"], {
      effects: { wrongType: "spectrum" },
    });
    expect(result.type).toBe("forbidden");
    if (result.type === "forbidden") {
      expect(result.reason).toMatch(/Effect spectrum not found/);
    }
  });

  test("rejects nonexistent effect", () => {
    const result = effectChecker.isAllowed(["effect:*"], {
      effects: { transportShipTrail: "ghost" },
    });
    expect(result.type).toBe("forbidden");
    if (result.type === "forbidden") {
      expect(result.reason).toMatch(/Effect ghost not found/);
    }
  });

  test("no effects in refs leaves cosmetics.effects undefined", () => {
    const result = effectChecker.isAllowed(["effect:*"], {});
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.effects).toBeUndefined();
    }
  });

  test("resolves an effect whose catalog key differs from its name", () => {
    // Catalog key "trail_01" but name "spectrum"; selection/flares are
    // name-based, so the name must still resolve and validate.
    const checker = new PrivilegeCheckerImpl(
      {
        patterns: {},
        colorPalettes: {},
        flags: {},
        effects: {
          transportShipTrail: {
            trail_01: {
              name: "spectrum",
              effectType: "transportShipTrail" as const,
              attributes: {
                type: "gradient" as const,
                colors: ["#ff0000", "#00ff00", "#0000ff"],
                colorSize: 16,
                movementSpeed: 0.15,
              },
              url: "",
              affiliateCode: null,
              product: null,
              rarity: "legendary",
            },
          },
        },
      },
      mockDecoder,
    );
    const result = checker.isAllowed(["effect:spectrum"], {
      effects: { transportShipTrail: "spectrum" },
    });
    expect(result.type).toBe("allowed");
    if (result.type === "allowed") {
      expect(result.cosmetics.effects?.transportShipTrail).toEqual({
        name: "spectrum",
        effectType: "transportShipTrail",
      });
    }
  });
});

describe("PrivilegeCheckerImpl#resolveClanTag", () => {
  // Reserved tags are stored uppercase, exactly as PrivilegeRefresher loads them.
  const makeChecker = (reservedTags: string[]) =>
    new PrivilegeCheckerImpl(mockCosmetics, mockDecoder, new Set(reservedTags));

  it("passes a null tag through unchanged", () => {
    const result = makeChecker(["ABC"]).resolveClanTag(null, []);
    expect(result).toEqual({ tag: null, dropped: false });
  });

  it("accepts a member's tag without consulting the reserved set (case-insensitive)", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("ABC", ["abc"]);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("drops a reserved tag the player does not belong to (impersonation)", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("ABC", ["other"]);
    expect(result).toEqual({ tag: null, dropped: true });
  });

  it("keeps a fictional tag matching no reserved clan", () => {
    const result = makeChecker(["OTHER"]).resolveClanTag("ABC", []);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("matches the reserved set case-insensitively", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("abc", ["other"]);
    expect(result).toEqual({ tag: null, dropped: true });
  });

  it("treats anonymous users as members of no clans", () => {
    const result = makeChecker(["ABC"]).resolveClanTag("ABC", []);
    expect(result).toEqual({ tag: null, dropped: true });
  });
});

describe("FailOpenPrivilegeChecker#resolveClanTag", () => {
  const checker = new FailOpenPrivilegeChecker();

  it("passes a null tag through unchanged", () => {
    const result = checker.resolveClanTag(null, []);
    expect(result).toEqual({ tag: null, dropped: false });
  });

  it("keeps a member's tag (known from owned tags, no lookup needed)", () => {
    const result = checker.resolveClanTag("ABC", ["abc"]);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("keeps a non-member's tag fail-open (no reserved set while infra is down)", () => {
    const result = checker.resolveClanTag("ABC", ["other"]);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });

  it("keeps an anonymous user's tag fail-open", () => {
    const result = checker.resolveClanTag("ABC", []);
    expect(result).toEqual({ tag: "ABC", dropped: false });
  });
});
