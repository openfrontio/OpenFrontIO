import type { Cosmetics, Promotion } from "@openfront/shared/CosmeticSchemas";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../resources/lang/en.json";
import {
  flashSaleItemName,
  salesPlayerCanBuy,
  type SaleBanner,
} from "../../../src/client/components/SaleBanner";
import type { ResolvedCosmetic } from "../../../src/client/Cosmetics";

const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

const flash: Promotion = {
  id: "f1",
  name: "Flash",
  percentOff: 90,
  endsAt: inHours(2),
  kind: "flash",
};
const weekend: Promotion = {
  id: "w1",
  name: "Weekend Sale",
  percentOff: 25,
  endsAt: inHours(30),
};

function catalogWith(where: string): Cosmetics {
  const sale = { priceHard: 10, listPriceHard: 100, promotion: flash };
  const catalog: Record<string, unknown> = {
    patterns: { stripes: { name: "stripes", priceHard: 50 } },
    flags: {},
    crowns: {},
    effects: {},
    packs: {},
  };
  if (where === "pattern") {
    catalog.patterns = { rocket: { name: "rocket", ...sale } };
  } else if (where === "flag") {
    catalog.flags = { aurora: { name: "aurora", ...sale } };
  } else if (where === "effect") {
    catalog.effects = {
      nukeTrail: { royal_spiral: { name: "royal_spiral", ...sale } },
    };
  } else if (where === "bundle") {
    catalog.packs = {
      starter: { name: "starter", displayName: "starter pack", ...sale },
    };
  }
  return catalog as unknown as Cosmetics;
}

// translateText reads flat keys ("store.flash_sale"), as LangSelector flattens.
function flatten(
  tree: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string"
        ? [[`${prefix}${key}`, value]]
        : Object.entries(
            flatten(value as Record<string, unknown>, `${prefix}${key}.`),
          ),
    ),
  );
}
const translations = flatten(en);

let banner: SaleBanner | undefined;
let lang: HTMLElement | undefined;

async function render(
  sales: Promotion[],
  cosmetics: Cosmetics,
  linked = false,
): Promise<SaleBanner> {
  lang = document.createElement("lang-selector");
  Object.assign(lang, {
    translations,
    defaultTranslations: translations,
    currentLang: "en",
  });
  document.body.appendChild(lang);
  banner = document.createElement("sale-banner") as SaleBanner;
  banner.sales = sales;
  banner.cosmetics = cosmetics;
  banner.linked = linked;
  document.body.appendChild(banner);
  await banner.updateComplete;
  return banner;
}

afterEach(() => {
  banner?.remove();
  lang?.remove();
  banner = undefined;
  lang = undefined;
});

describe("SaleBanner flash sale", () => {
  it("names the item a flash sale is on, of any kind", async () => {
    await render([], catalogWith("pattern"));
    expect(flashSaleItemName(catalogWith("pattern"), "f1")).toBe("Rocket");
    expect(flashSaleItemName(catalogWith("flag"), "f1")).toBe("Aurora");
    expect(flashSaleItemName(catalogWith("effect"), "f1")).toBe("Royal Spiral");
    expect(flashSaleItemName(catalogWith("bundle"), "f1")).toBe("Starter Pack");
    expect(flashSaleItemName(catalogWith("none"), "f1")).toBeNull();
    expect(flashSaleItemName(null, "f1")).toBeNull();
  });

  it("says which item is on sale when the flash sale runs alone", async () => {
    const b = await render([flash], catalogWith("pattern"), true);
    const line = b.querySelector("[data-store-flash-banner]")!;
    expect(line.textContent).toContain("Rocket");
    expect(line.textContent).toContain("90% off");
  });

  it("says which item is on sale on the row under another sale", async () => {
    const b = await render([weekend, flash], catalogWith("pattern"));
    const row = b.querySelector("[data-store-flash-banner]")!;
    expect(row.textContent).toContain("Rocket");
  });

  it("falls back to 'one item' when the catalog lacks the item", async () => {
    const b = await render([flash], catalogWith("none"), true);
    const line = b.querySelector("[data-store-flash-banner]")!;
    expect(line.textContent).toContain(
      en.store.flash_sale_banner.replace("{percent}", "90"),
    );
  });

  it("counts down to the end of this deal, not to the next item", async () => {
    for (const sales of [[flash], [weekend, flash]]) {
      const b = await render(sales, catalogWith("pattern"));
      const line = b.querySelector("[data-store-flash-banner]")!;
      expect(line.textContent).toContain(en.store.flash_ends_in);
      expect(line.textContent).not.toContain("Next item");
      b.remove();
      lang!.remove();
    }
  });

  it("shows an arrow on a home-screen banner, which opens the store", async () => {
    const b = await render([weekend], catalogWith("none"), true);
    expect(
      b.querySelector("[data-store-sale-banner] [data-sale-open]"),
    ).toBeTruthy();
    b.remove();
    lang!.remove();
    const alone = await render([flash], catalogWith("pattern"), true);
    expect(
      alone.querySelector("[data-store-sale-banner] [data-sale-open]"),
    ).toBeTruthy();
  });
});

describe("salesPlayerCanBuy", () => {
  const onSale = { priceHard: 10, listPriceHard: 100 };
  const aurora = { name: "aurora", ...onSale, promotion: flash };
  const catalog = {
    patterns: {},
    flags: { aurora },
    crowns: {},
    effects: {},
    packs: {},
  } as unknown as Cosmetics;
  const resolved = (cosmetic: object): ResolvedCosmetic =>
    ({
      type: "flag",
      cosmetic,
      colorPalette: null,
      relationship: "purchasable",
      key: "flag:x",
    }) as unknown as ResolvedCosmetic;

  it("drops a flash sale on an item the player can't buy (they own it)", () => {
    expect(salesPlayerCanBuy([flash, weekend], catalog, [])).toEqual([weekend]);
  });

  it("keeps a flash sale on an item the player can buy", () => {
    expect(
      salesPlayerCanBuy([flash, weekend], catalog, [resolved(aurora)]),
    ).toEqual([flash, weekend]);
  });

  it("doesn't count an item tagged with the sale but no longer discounted", () => {
    // The tag without a discount (a stale price) doesn't count as buyable.
    const stale = { name: "aurora", priceHard: 100, promotion: flash };
    expect(salesPlayerCanBuy([flash], catalog, [resolved(stale)])).toEqual([]);
  });

  it("drops a sale tagged only on what the On sale tab doesn't list", () => {
    const supporter = { name: "supporter", ...onSale, promotion: flash };
    const coins = { name: "coins", ...onSale, promotion: flash };
    const withSub = {
      ...catalog,
      flags: {},
      subscriptions: { supporter },
      currencyPacks: { coins },
    } as unknown as Cosmetics;
    const asType = (type: string, cosmetic: object): ResolvedCosmetic =>
      ({ ...resolved(cosmetic), type }) as ResolvedCosmetic;
    // Buyable or not, a subscription or a currency pack isn't on the tab.
    expect(salesPlayerCanBuy([flash], withSub, [])).toEqual([]);
    expect(
      salesPlayerCanBuy([flash], withSub, [
        asType("subscription", supporter),
        asType("pack", coins),
      ]),
    ).toEqual([]);
    // A bundle in the same sale is on the tab, so the sale keeps its banner.
    const bundle = { name: "starter", ...onSale, promotion: flash };
    expect(
      salesPlayerCanBuy([flash], withSub, [asType("cosmeticPack", bundle)]),
    ).toEqual([flash]);
  });

  it("drops a sale tagged only on a card background", () => {
    const neon = { name: "neon-grid", url: "", ...onSale, promotion: flash };
    const withCard = {
      ...catalog,
      flags: {},
      cardBackgrounds: { "neon-grid": neon },
    } as unknown as Cosmetics;
    const card = {
      ...resolved(neon),
      type: "cardBackground",
    } as unknown as ResolvedCosmetic;
    // Buyable, but the On sale tab doesn't list card items.
    expect(salesPlayerCanBuy([flash], withCard, [card])).toEqual([]);
  });

  it.each([
    ["a card title", "cardTitles"],
    ["a taunt", "taunts"],
    ["a tier that isn't for sale", "unlistedSubscriptions"],
  ])("drops a sale tagged only on %s", (_, section) => {
    const item = { name: "x", ...onSale, promotion: flash };
    const tagged = {
      ...catalog,
      flags: {},
      [section]: { x: item },
    } as unknown as Cosmetics;
    expect(salesPlayerCanBuy([flash], tagged, [])).toEqual([]);
  });

  it("keeps a sale the catalog tags no item with", () => {
    expect(salesPlayerCanBuy([weekend], catalog, [])).toEqual([weekend]);
    expect(salesPlayerCanBuy([flash], null, [])).toEqual([flash]);
  });
});
