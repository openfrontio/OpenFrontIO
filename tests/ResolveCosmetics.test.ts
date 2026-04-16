import { resolveCosmetics } from "../src/client/Cosmetics";
import { UserMeResponse } from "../src/core/ApiSchemas";
import { Cosmetics } from "../src/core/CosmeticSchemas";

const product = { productId: "prod_1", priceId: "price_1", price: "$4.99" };

function makeCosmetics(overrides: Partial<Cosmetics> = {}): Cosmetics {
  return {
    patterns: {},
    flags: {},
    colorPalettes: {},
    ...overrides,
  } as Cosmetics;
}

function makeUserMe(flares: string[] = []): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "test",
      flares,
      achievements: { singleplayerMap: [] },
    },
  } as UserMeResponse;
}

describe("resolveCosmetics", () => {
  test("returns empty array for null cosmetics", () => {
    expect(resolveCosmetics(null, false, null)).toEqual([]);
  });

  test("always includes default pattern as first item, owned", () => {
    const result = resolveCosmetics(makeCosmetics(), false, null);
    expect(result[0]).toEqual({
      type: "pattern",
      cosmetic: null,
      colorPalette: null,
      relationship: "owned",
      key: "pattern:default",
    });
  });

  describe("patterns", () => {
    const pattern = {
      type: "pattern" as const,
      name: "stripes",
      pattern: "AAAAAA",
      affiliateCode: null,
      product,
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "common",
      colorPalettes: [
        { name: "red", isArchived: false },
        { name: "blue", isArchived: false },
      ],
    };

    const colorPalettes = {
      red: { name: "red", primaryColor: "#ff0000", secondaryColor: "#000000" },
      blue: {
        name: "blue",
        primaryColor: "#0000ff",
        secondaryColor: "#ffffff",
      },
    };

    test("expands pattern × colorPalettes + null palette", () => {
      const cosmetics = makeCosmetics({
        patterns: { stripes: pattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(cosmetics, false, null);
      // default + red + blue + null-palette
      const patternItems = result.filter((r) =>
        r.key.startsWith("pattern:stripes"),
      );
      expect(patternItems).toHaveLength(3);
      expect(patternItems.map((r) => r.key)).toEqual([
        "pattern:stripes:red",
        "pattern:stripes:blue",
        "pattern:stripes",
      ]);
    });

    test("resolves color palette from cosmetics.colorPalettes", () => {
      const cosmetics = makeCosmetics({
        patterns: { stripes: pattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(cosmetics, false, null);
      const redItem = result.find((r) => r.key === "pattern:stripes:red");
      expect(redItem?.colorPalette).toEqual(colorPalettes.red);
    });

    test("null palette entry has null colorPalette", () => {
      const cosmetics = makeCosmetics({
        patterns: { stripes: pattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(cosmetics, false, null);
      const nullPaletteItem = result.find((r) => r.key === "pattern:stripes");
      expect(nullPaletteItem?.colorPalette).toBeNull();
    });

    test("pattern with no colorPalettes produces single null-palette entry", () => {
      const noPalettePattern = { ...pattern, colorPalettes: undefined };
      const cosmetics = makeCosmetics({
        patterns: { stripes: noPalettePattern as any },
      });
      const result = resolveCosmetics(cosmetics, false, null);
      const patternItems = result.filter((r) =>
        r.key.startsWith("pattern:stripes"),
      );
      expect(patternItems).toHaveLength(1);
      expect(patternItems[0].key).toBe("pattern:stripes");
    });

    test("purchasable when user has no flares and product exists", () => {
      const cosmetics = makeCosmetics({
        patterns: { stripes: pattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), null);
      const redItem = result.find((r) => r.key === "pattern:stripes:red");
      expect(redItem?.relationship).toBe("purchasable");
    });

    test("owned when user has specific flare", () => {
      const cosmetics = makeCosmetics({
        patterns: { stripes: pattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(
        cosmetics,
        makeUserMe(["pattern:stripes:red"]),
        null,
      );
      const redItem = result.find((r) => r.key === "pattern:stripes:red");
      expect(redItem?.relationship).toBe("owned");
    });

    test("owned when user has wildcard flare", () => {
      const cosmetics = makeCosmetics({
        patterns: { stripes: pattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(
        cosmetics,
        makeUserMe(["pattern:*"]),
        null,
      );
      const redItem = result.find((r) => r.key === "pattern:stripes:red");
      expect(redItem?.relationship).toBe("owned");
    });

    test("blocked when affiliate code mismatch", () => {
      const affiliatePattern = { ...pattern, affiliateCode: "partner1" };
      const cosmetics = makeCosmetics({
        patterns: { stripes: affiliatePattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), null);
      const redItem = result.find((r) => r.key === "pattern:stripes:red");
      expect(redItem?.relationship).toBe("blocked");
    });

    test("purchasable when affiliate code matches", () => {
      const affiliatePattern = { ...pattern, affiliateCode: "partner1" };
      const cosmetics = makeCosmetics({
        patterns: { stripes: affiliatePattern as any },
        colorPalettes,
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), "partner1");
      const redItem = result.find((r) => r.key === "pattern:stripes:red");
      expect(redItem?.relationship).toBe("purchasable");
    });

    test("archived palette is blocked unless owned", () => {
      const archivedPattern = {
        ...pattern,
        colorPalettes: [{ name: "old", isArchived: true }],
      };
      const cosmetics = makeCosmetics({
        patterns: { stripes: archivedPattern as any },
        colorPalettes: {
          old: {
            name: "old",
            primaryColor: "#111",
            secondaryColor: "#222",
          },
        },
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), null);
      const oldItem = result.find((r) => r.key === "pattern:stripes:old");
      expect(oldItem?.relationship).toBe("blocked");
    });

    test("archived palette is owned when user has specific flare", () => {
      const archivedPattern = {
        ...pattern,
        colorPalettes: [{ name: "old", isArchived: true }],
      };
      const cosmetics = makeCosmetics({
        patterns: { stripes: archivedPattern as any },
        colorPalettes: {
          old: {
            name: "old",
            primaryColor: "#111",
            secondaryColor: "#222",
          },
        },
      });
      const result = resolveCosmetics(
        cosmetics,
        makeUserMe(["pattern:stripes:old"]),
        null,
      );
      const oldItem = result.find((r) => r.key === "pattern:stripes:old");
      expect(oldItem?.relationship).toBe("owned");
    });
  });

  describe("flags", () => {
    const flag = {
      type: "flag" as const,
      name: "cool_flag",
      url: "https://example.com/cool.png",
      affiliateCode: null,
      product,
      priceSoft: undefined,
      priceHard: undefined,
      rarity: "rare",
    };

    test("includes flags with correct key", () => {
      const cosmetics = makeCosmetics({
        flags: { cool_flag: flag as any },
      });
      const result = resolveCosmetics(cosmetics, false, null);
      const flagItem = result.find((r) => r.key === "flag:cool_flag");
      expect(flagItem).toBeDefined();
      expect(flagItem?.cosmetic).toEqual(flag);
      expect(flagItem?.colorPalette).toBeNull();
    });

    test("purchasable when not logged in and product exists", () => {
      const cosmetics = makeCosmetics({
        flags: { cool_flag: flag as any },
      });
      const result = resolveCosmetics(cosmetics, false, null);
      const flagItem = result.find((r) => r.key === "flag:cool_flag");
      expect(flagItem?.relationship).toBe("purchasable");
    });

    test("owned with wildcard flare", () => {
      const cosmetics = makeCosmetics({
        flags: { cool_flag: flag as any },
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(["flag:*"]), null);
      const flagItem = result.find((r) => r.key === "flag:cool_flag");
      expect(flagItem?.relationship).toBe("owned");
    });

    test("owned with specific flare", () => {
      const cosmetics = makeCosmetics({
        flags: { cool_flag: flag as any },
      });
      const result = resolveCosmetics(
        cosmetics,
        makeUserMe(["flag:cool_flag"]),
        null,
      );
      const flagItem = result.find((r) => r.key === "flag:cool_flag");
      expect(flagItem?.relationship).toBe("owned");
    });

    test("blocked with no product", () => {
      const freeFlag = { ...flag, product: null };
      const cosmetics = makeCosmetics({
        flags: { cool_flag: freeFlag as any },
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), null);
      const flagItem = result.find((r) => r.key === "flag:cool_flag");
      expect(flagItem?.relationship).toBe("blocked");
    });
  });

  describe("mixed cosmetics", () => {
    test("returns all types in order: default, patterns, flags", () => {
      const cosmetics = makeCosmetics({
        patterns: {
          stripes: {
            type: "pattern" as const,
            name: "stripes",
            pattern: "AAAAAA",
            affiliateCode: null,
            product,
            priceSoft: null,
            priceHard: null,
            rarity: "common",
          } as any,
        },
        flags: {
          heart: {
            type: "flag" as const,
            name: "heart",
            url: "/flags/heart.svg",
            affiliateCode: null,
            product,
            priceSoft: null,
            priceHard: null,
            rarity: "common",
          } as any,
        },
      });
      const result = resolveCosmetics(cosmetics, false, null);
      const keys = result.map((r) => r.key);
      expect(keys[0]).toBe("pattern:default");
      expect(keys).toContain("pattern:stripes");
      expect(keys).toContain("flag:heart");
      // patterns come before flags
      const patternIdx = keys.indexOf("pattern:stripes");
      const flagIdx = keys.indexOf("flag:heart");
      expect(patternIdx).toBeLessThan(flagIdx);
    });
  });
});
