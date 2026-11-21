import { describe, expect, it } from "vitest";
import {
  pickSpotlightItems,
  storeItemHash,
} from "../../src/client/components/ShopSpotlight";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const LATER = "2026-11-25T12:00:00Z";

function item(
  type: ResolvedCosmetic["type"],
  name: string,
  extra: Record<string, unknown> = {},
  relationship: ResolvedCosmetic["relationship"] = "purchasable",
  palette: string | null = null,
): ResolvedCosmetic {
  return {
    type,
    cosmetic: { name, priceSoft: 100, rarity: "common", ...extra } as never,
    colorPalette: palette === null ? null : ({ name: palette } as never),
    relationship,
    key: palette === null ? `${type}:${name}` : `${type}:${name}:${palette}`,
  };
}

const keys = (items: ResolvedCosmetic[]) => items.map((r) => r.key);

describe("pickSpotlightItems", () => {
  it("leads with items on sale, then new ones (newest first), then the rest", () => {
    const picked = pickSpotlightItems(
      [
        item("pattern", "plain"),
        item("flag", "newer", { newUntil: "2026-11-30T00:00:00Z" }),
        item("crown", "older", { newUntil: LATER }),
        item("skin", "discounted", {
          priceSoft: 80,
          listPriceSoft: 100,
          promotion: { percentOff: 20, endsAt: LATER },
        }),
      ],
      () => 0,
      NOW,
    );
    expect(keys(picked)).toEqual([
      "skin:discounted",
      "flag:newer",
      "crown:older",
    ]);
  });

  it("skips owned, unpriced and non-linkable items, and shows each pattern once", () => {
    const picked = pickSpotlightItems(
      [
        item("pattern", "stripes", {}, "purchasable", "red"),
        item("pattern", "stripes", {}, "purchasable", "blue"),
        item("pattern", "owned", {}, "owned"),
        item("flag", "free", { priceSoft: undefined }),
        item("effect", "trail"),
        item("pack", "plutonium"),
      ],
      () => 0,
      NOW,
    );
    expect(keys(picked)).toEqual(["pattern:stripes:red"]);
  });

  it("fills the remaining slots at random, three at most", () => {
    const pool = ["a", "b", "c", "d", "e"].map((n) => item("flag", n));
    expect(pickSpotlightItems(pool, () => 0, NOW)).toHaveLength(3);
    const seen = new Set<string>();
    let seed = 1;
    const random = () =>
      ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 50; i++) {
      for (const k of keys(pickSpotlightItems(pool, random, NOW))) seen.add(k);
    }
    expect(seen.size).toBe(5);
  });

  it("ignores a sale whose end has passed", () => {
    const picked = pickSpotlightItems(
      [
        item("flag", "plain"),
        item("flag", "ended", {
          priceSoft: 80,
          listPriceSoft: 100,
          promotion: { percentOff: 20, endsAt: "2026-11-19T00:00:00Z" },
        }),
      ],
      () => 0.99,
      NOW,
    );
    expect(keys(picked)).toEqual(["flag:plain", "flag:ended"]);
  });
});

describe("storeItemHash", () => {
  it("deep-links the store to the item", () => {
    expect(
      storeItemHash(item("pattern", "stripes", {}, "purchasable", "red")),
    ).toBe("#modal=store&tab=cosmetics&item=pattern%3Astripes%3Ared");
  });
});
