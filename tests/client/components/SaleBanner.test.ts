import type { Cosmetics, Promotion } from "@openfront/shared/CosmeticSchemas";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../resources/lang/en.json";
import {
  flashSaleItemName,
  type SaleBanner,
} from "../../../src/client/components/SaleBanner";

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
