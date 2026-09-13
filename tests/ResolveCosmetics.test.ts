import {
  groupCosmeticVariants,
  ownedPackItems,
  packItemFlare,
  resolveCosmetics,
  ResolvedCosmetic,
} from "../src/client/Cosmetics";
import { UserMeResponse } from "../src/core/ApiSchemas";
import { CosmeticPack, Cosmetics } from "../src/core/CosmeticSchemas";

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
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      flares,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
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
      product: null,
      priceSoft: undefined,
      priceHard: 100,
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

    test("purchasable when user has no flares and currency price exists", () => {
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
      product: null,
      priceSoft: undefined,
      priceHard: 50,
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

    test("purchasable when not logged in and currency price exists", () => {
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

    test("blocked with no currency price", () => {
      const freeFlag = { ...flag, priceHard: undefined };
      const cosmetics = makeCosmetics({
        flags: { cool_flag: freeFlag as any },
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), null);
      const flagItem = result.find((r) => r.key === "flag:cool_flag");
      expect(flagItem?.relationship).toBe("blocked");
    });
  });

  describe("crowns", () => {
    const crown = {
      name: "gold_crown",
      url: "http://localhost:8787/public/cosmetics/crown/gold",
      affiliateCode: null,
      product: null,
      priceSoft: undefined,
      priceHard: 5,
      artist: "sadfas",
      rarity: "common",
    };

    test("includes crowns with correct key", () => {
      const cosmetics = makeCosmetics({
        crowns: { gold_crown: crown as any },
      });
      const result = resolveCosmetics(cosmetics, false, null);
      const crownItem = result.find((r) => r.key === "crown:gold_crown");
      expect(crownItem).toBeDefined();
      expect(crownItem?.cosmetic).toEqual(crown);
      expect(crownItem?.colorPalette).toBeNull();
    });

    test("purchasable when user has no flares and priceHard exists", () => {
      const cosmetics = makeCosmetics({
        crowns: { gold_crown: crown as any },
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), null);
      const crownItem = result.find((r) => r.key === "crown:gold_crown");
      expect(crownItem?.relationship).toBe("purchasable");
    });

    test("owned with wildcard flare", () => {
      const cosmetics = makeCosmetics({
        crowns: { gold_crown: crown as any },
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(["crown:*"]), null);
      const crownItem = result.find((r) => r.key === "crown:gold_crown");
      expect(crownItem?.relationship).toBe("owned");
    });

    test("owned with specific flare", () => {
      const cosmetics = makeCosmetics({
        crowns: { gold_crown: crown as any },
      });
      const result = resolveCosmetics(
        cosmetics,
        makeUserMe(["crown:gold_crown"]),
        null,
      );
      const crownItem = result.find((r) => r.key === "crown:gold_crown");
      expect(crownItem?.relationship).toBe("owned");
    });

    test("blocked with no currency price", () => {
      const freeCrown = {
        ...crown,
        priceHard: undefined,
      };
      const cosmetics = makeCosmetics({
        crowns: { gold_crown: freeCrown as any },
      });
      const result = resolveCosmetics(cosmetics, makeUserMe(), null);
      const crownItem = result.find((r) => r.key === "crown:gold_crown");
      expect(crownItem?.relationship).toBe("blocked");
    });
  });

  describe("groupCosmeticVariants", () => {
    const patternVariant = (
      patternName: string,
      paletteName: string | null,
    ): ResolvedCosmetic => ({
      type: "pattern",
      cosmetic: { name: patternName } as any,
      colorPalette: paletteName
        ? { name: paletteName, primaryColor: "#fff", secondaryColor: "#000" }
        : null,
      relationship: "purchasable",
      key: paletteName
        ? `pattern:${patternName}:${paletteName}`
        : `pattern:${patternName}`,
    });

    const skinVariant = (name: string): ResolvedCosmetic => ({
      type: "skin",
      cosmetic: { name } as any,
      colorPalette: null,
      relationship: "purchasable",
      key: `skin:${name}`,
    });

    test("collapses colour variants of the same pattern into one group", () => {
      const groups = groupCosmeticVariants([
        patternVariant("stripes", "red"),
        patternVariant("stripes", "blue"),
        patternVariant("stripes", "green"),
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0].map((r) => r.key)).toEqual([
        "pattern:stripes:red",
        "pattern:stripes:blue",
        "pattern:stripes:green",
      ]);
    });

    test("keeps distinct patterns in separate groups, first-seen order", () => {
      const groups = groupCosmeticVariants([
        patternVariant("stripes", "red"),
        patternVariant("dots", "red"),
        patternVariant("stripes", "blue"),
      ]);
      expect(groups).toHaveLength(2);
      expect(groups[0].map((r) => r.key)).toEqual([
        "pattern:stripes:red",
        "pattern:stripes:blue",
      ]);
      expect(groups[1].map((r) => r.key)).toEqual(["pattern:dots:red"]);
    });

    test("skins are never grouped — one group each", () => {
      const groups = groupCosmeticVariants([
        skinVariant("mountain"),
        skinVariant("ocean"),
        patternVariant("stripes", "red"),
      ]);
      expect(groups).toHaveLength(3);
      expect(groups.map((g) => g.length)).toEqual([1, 1, 1]);
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
            product: null,
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
            product: null,
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

describe("resolveCosmetics cosmetic packs", () => {
  const camo = {
    name: "camo",
    pattern: "AAAAAA",
    product: null,
    priceHard: 100,
    rarity: "common",
    colorPalettes: [{ name: "red", isArchived: false }],
  };
  const pirate = {
    name: "pirate",
    url: "/flags/pirate.svg",
    product: null,
    rarity: "common",
  };
  const gradient = {
    name: "ship_trail_gradient",
    effectType: "nukeTrail",
    attributes: {
      type: "gradient",
      colors: ["#f00"],
      colorSize: 1,
      movementSpeed: 0,
    },
    product: null,
    rarity: "rare",
  };
  const starter = {
    name: "starter",
    displayName: "Starter Pack",
    description: "",
    priceHard: 250,
    rarity: "common",
    items: [
      { type: "pattern" as const, name: "camo" },
      { type: "flag" as const, name: "pirate" },
      { type: "effect" as const, name: "ship_trail_gradient" },
    ],
  };
  const catalog = () =>
    makeCosmetics({
      patterns: { camo: camo as any },
      flags: { pirate: pirate as any },
      effects: { nukeTrail: { ship_trail_gradient: gradient as any } },
      packs: { starter },
    });
  const packOf = (result: ResolvedCosmetic[]) =>
    result.find((r) => r.type === "cosmeticPack")!;

  test("resolves the pack's items in pack order against the catalog", () => {
    const resolved = packOf(resolveCosmetics(catalog(), makeUserMe(), null));
    expect(resolved.key).toBe("cosmeticPack:starter");
    expect(resolved.cosmetic).toBe(starter);
    // A pattern item is its uncoloured entry (the pack grants "pattern:camo");
    // an effect is found by name without knowing its effectType.
    expect(resolved.packItems?.map((item) => item.key)).toEqual([
      "pattern:camo",
      "flag:pirate",
      "effect:nukeTrail:ship_trail_gradient",
    ]);
  });

  test("skips items whose cosmetic is no longer in the catalog", () => {
    const cosmetics = catalog();
    delete cosmetics.flags.pirate;
    const resolved = packOf(resolveCosmetics(cosmetics, makeUserMe(), null));
    expect(resolved.packItems?.map((item) => item.key)).toEqual([
      "pattern:camo",
      "effect:nukeTrail:ship_trail_gradient",
    ]);
  });

  test("includes items that are not sold on their own", () => {
    // pirate has no price of its own (a pack exclusive) — still a pack item.
    const resolved = packOf(resolveCosmetics(catalog(), makeUserMe(), null));
    expect(resolved.packItems?.[1].relationship).toBe("blocked");
    expect(resolved.relationship).toBe("purchasable");
  });

  test("purchasable when the player owns none of the items", () => {
    expect(
      packOf(resolveCosmetics(catalog(), makeUserMe(), null)).relationship,
    ).toBe("purchasable");
    expect(packOf(resolveCosmetics(catalog(), false, null)).relationship).toBe(
      "purchasable",
    );
  });

  test("owned when every item's flare (or type wildcard) is owned", () => {
    const owned = packOf(
      resolveCosmetics(
        catalog(),
        makeUserMe(["pattern:camo", "flag:*", "effect:ship_trail_gradient"]),
        null,
      ),
    );
    expect(owned.relationship).toBe("owned");
  });

  test("blocked when only some items are owned (no partial purchase)", () => {
    const partial = packOf(
      resolveCosmetics(catalog(), makeUserMe(["flag:pirate"]), null),
    );
    expect(partial.relationship).toBe("blocked");
    expect(
      ownedPackItems(
        partial.cosmetic as CosmeticPack,
        makeUserMe(["flag:pirate"]),
      ),
    ).toEqual([{ type: "flag", name: "pirate" }]);
  });

  test("blocked in affiliate mode, with no items, or without a price", () => {
    expect(
      packOf(resolveCosmetics(catalog(), makeUserMe(), "creator")).relationship,
    ).toBe("blocked");
    expect(
      packOf(
        resolveCosmetics(
          makeCosmetics({ packs: { starter: { ...starter, items: [] } } }),
          makeUserMe(),
          null,
        ),
      ).relationship,
    ).toBe("blocked");
    expect(
      packOf(
        resolveCosmetics(
          makeCosmetics({ packs: { starter: { ...starter, priceHard: 0 } } }),
          makeUserMe(),
          null,
        ),
      ).relationship,
    ).toBe("blocked");
  });

  test("packItemFlare is the flare the purchase grants", () => {
    expect(packItemFlare({ type: "effect", name: "ship_trail_gradient" })).toBe(
      "effect:ship_trail_gradient",
    );
    expect(
      packItemFlare({ type: "pattern", name: "camo", colorPalette: "red" }),
    ).toBe("pattern:camo:red");
  });

  describe("pattern items with a colour palette", () => {
    const coloured = {
      ...starter,
      items: [{ type: "pattern" as const, name: "camo", colorPalette: "red" }],
    };
    const catalogWith = (packs: Record<string, typeof coloured>) =>
      makeCosmetics({
        patterns: { camo: camo as any },
        colorPalettes: {
          red: { name: "red", primaryColor: "#f00", secondaryColor: "#000" },
        },
        packs,
      });

    test("resolve to that palette's entry, the one the granted flare unlocks", () => {
      const resolved = packOf(
        resolveCosmetics(
          catalogWith({ starter: coloured }),
          makeUserMe(),
          null,
        ),
      );
      expect(resolved.packItems?.map((item) => item.key)).toEqual([
        "pattern:camo:red",
      ]);
      expect(resolved.packItems?.[0].colorPalette?.name).toBe("red");
    });

    test("are owned by the palette flare, not the bare pattern flare", () => {
      const cosmetics = catalogWith({ starter: coloured });
      expect(
        packOf(resolveCosmetics(cosmetics, makeUserMe(["pattern:camo"]), null))
          .relationship,
      ).toBe("purchasable");
      expect(
        packOf(
          resolveCosmetics(cosmetics, makeUserMe(["pattern:camo:red"]), null),
        ).relationship,
      ).toBe("owned");
    });

    test("skip a palette the pattern no longer offers", () => {
      const resolved = packOf(
        resolveCosmetics(
          catalogWith({
            starter: {
              ...coloured,
              items: [{ type: "pattern", name: "camo", colorPalette: "gone" }],
            },
          }),
          makeUserMe(),
          null,
        ),
      );
      expect(resolved.packItems).toEqual([]);
    });
  });
});
