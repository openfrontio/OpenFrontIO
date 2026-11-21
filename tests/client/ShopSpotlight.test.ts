import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nextSpotlightDeadline,
  pickSpotlightItems,
  storeItemHash,
} from "../../src/client/components/ShopSpotlight";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";

const catalog = vi.hoisted(() => ({
  items: [] as unknown[],
  // What fetchCosmetics answers: a fresh object per fetch, or null (failed).
  fetch: (() => ({})) as () => object | null,
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: async () => catalog.fetch(),
  resolveCosmetics: () => catalog.items,
}));

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

describe("nextSpotlightDeadline", () => {
  it("is the earliest sale or new end still ahead", () => {
    const items = [
      item("flag", "new", { newUntil: "2026-11-22T00:00:00Z" }),
      item("skin", "sale", {
        priceSoft: 80,
        listPriceSoft: 100,
        promotion: { percentOff: 20, endsAt: "2026-11-21T00:00:00Z" },
      }),
      item("crown", "was_new", { newUntil: "2026-11-19T00:00:00Z" }),
    ];
    expect(nextSpotlightDeadline(items, NOW)).toBe(
      Date.parse("2026-11-21T00:00:00Z"),
    );
    expect(nextSpotlightDeadline([item("flag", "plain")], NOW)).toBeNull();
  });
});

describe("<shop-spotlight>", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    catalog.fetch = () => ({});
    vi.useRealTimers();
  });

  it("picks again when a shown sale ends", async () => {
    vi.useFakeTimers({ now: NOW });
    catalog.items = [
      item("skin", "sale", {
        priceSoft: 80,
        listPriceSoft: 100,
        promotion: { percentOff: 20, endsAt: "2026-11-20T13:00:00Z" },
      }),
    ];
    await import("../../src/client/components/ShopSpotlight");
    const el = document.createElement("shop-spotlight") as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    expect(el.textContent).toContain("store.sale_percent_off");

    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1_000);
    await el.updateComplete;
    expect(el.textContent).not.toContain("store.sale_percent_off");
    expect(el.querySelectorAll("a[href*='item=']")).toHaveLength(1);
  });

  it("stops its timer once disconnected", async () => {
    vi.useFakeTimers({ now: NOW });
    catalog.items = [item("flag", "new", { newUntil: LATER })];
    await import("../../src/client/components/ShopSpotlight");
    const el = document.createElement("shop-spotlight");
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("<shop-spotlight> rechecks", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    catalog.fetch = () => ({});
    vi.useRealTimers();
  });

  const mount = async () => {
    await import("../../src/client/components/ShopSpotlight");
    const el = document.createElement("shop-spotlight") as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    return el;
  };
  const shown = (el: HTMLElement) =>
    [...el.querySelectorAll("a[href*='item=']")].map((a) =>
      a.getAttribute("href"),
    );

  it("appears once a failed first fetch succeeds on a later recheck", async () => {
    vi.useFakeTimers({ now: NOW });
    catalog.items = [item("flag", "plain")];
    catalog.fetch = () => null;
    const el = await mount();
    expect(el.style.display).toBe("none");

    catalog.fetch = () => ({});
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await el.updateComplete;
    expect(el.style.display).not.toBe("none");
    expect(shown(el)).toHaveLength(1);
  });

  it("puts a sale that started since the last fetch first", async () => {
    vi.useFakeTimers({ now: NOW });
    catalog.items = ["a", "b", "c", "d"].map((n) => item("flag", n));
    const el = await mount();
    expect(shown(el)).not.toContain(storeItemHash(item("skin", "deal")));

    catalog.items = [
      ...catalog.items,
      item("skin", "deal", {
        priceSoft: 80,
        listPriceSoft: 100,
        promotion: { percentOff: 20, endsAt: LATER },
      }),
    ];
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await el.updateComplete;
    expect(shown(el)[0]).toBe(storeItemHash(item("skin", "deal")));
  });

  it("keeps the same tiles when the catalog hasn't changed", async () => {
    vi.useFakeTimers({ now: NOW });
    catalog.items = ["a", "b", "c", "d", "e", "f"].map((n) => item("flag", n));
    const el = await mount();
    const before = shown(el);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await el.updateComplete;
      expect(shown(el)).toEqual(before);
    }
  });
});
