import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
const heldBack = vi.hoisted(() => ({ taunts: false, titles: false }));
vi.mock("../../src/client/components/card/HeldBack", () => ({
  get CARD_TAUNTS_ENABLED() {
    return heldBack.taunts;
  },
  get CARD_TITLES_ENABLED() {
    return heldBack.titles;
  },
}));
vi.mock("../../src/client/Cosmetics", () => ({
  purchaseCosmetic: vi.fn(),
}));

import { StorePlacementSubTabSchema } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { CardStoreGrid } from "../../src/client/components/card/CardStoreGrid";

// Taunts and titles are held back (HeldBack.ts). The tests below exercise
// the code behind them with both switched on; the "held back" block turns
// them off again.
beforeEach(() => {
  heldBack.taunts = true;
  heldBack.titles = true;
});

if (!customElements.get("card-store-grid")) {
  customElements.define("card-store-grid", CardStoreGrid);
}

const item = { product: null, rarity: "epic" };
const COSMETICS = {
  patterns: {},
  flags: {},
  playerCards: { standard: { ...item, name: "standard", priceHard: 300 } },
  cardTrackers: {
    wins: { ...item, name: "wins", stat: "wins", priceSoft: 400 },
  },
  cardBackgrounds: {
    bg_frontline: {
      ...item,
      name: "bg_frontline",
      url: "/bg.webp",
      priceHard: 2400,
    },
    bg_redplanet: {
      ...item,
      name: "bg_redplanet",
      url: "/red.webp",
      unlockSource: { kind: "seasonFree", label: "Season 1" },
    },
  },
  cardTitles: {
    warmonger: { ...item, name: "warmonger", text: "Warmonger" },
    veteran: { ...item, name: "veteran", text: "Veteran", priceSoft: 500 },
  },
  taunts: {
    salute: {
      ...item,
      name: "salute",
      tauntKind: "icon",
      preset: "salute",
      priceSoft: 800,
    },
  },
} as unknown as Cosmetics;

// A card item whose sale has ended, though the catalogue in hand still holds
// the sale price, and one whose sale is still running.
const ENDED = new Date(Date.now() - 60_000).toISOString();
const RUNNING = new Date(Date.now() + 3_600_000).toISOString();
const onSale = (name: string, endsAt: string) => ({
  product: null,
  rarity: "epic",
  name,
  url: `/${name}.webp`,
  priceHard: 400,
  listPriceHard: 600,
  priceSoft: 4000,
  listPriceSoft: 6000,
  promotion: { id: "s1", name: "Sale", percentOff: 33, endsAt },
});
type PriceProps = {
  priceHard: number | null;
  priceSoft: number | null;
  listPriceHard: number | null;
  listPriceSoft: number | null;
};

describe("<card-store-grid>", () => {
  let grid: CardStoreGrid;
  afterEach(() => grid?.remove());

  async function render(flares: string[] = [], tracker?: unknown) {
    grid = document.createElement(
      "card-store-grid",
    ) as unknown as CardStoreGrid;
    grid.cosmetics = COSMETICS;
    grid.flares = flares;
    if (tracker) grid.tracker = tracker as CardStoreGrid["tracker"];
    document.body.appendChild(grid as unknown as Node);
    await grid.updateComplete;
  }
  const keys = () =>
    [
      ...(grid as unknown as Element).querySelectorAll(
        "[data-card-store-item]",
      ),
    ].map((e) => e.getAttribute("data-card-store-item"));

  it("titles held back: no title items", async () => {
    heldBack.titles = false;
    await render();
    expect(keys().filter((k) => k!.startsWith("cardTitle:"))).toEqual([]);
    expect(keys()).toContain("cardTracker:wins");
  });

  it("titles switched on: a sold title is listed", async () => {
    await render();
    expect(keys()).toContain("cardTitle:veteran");
  });

  it("taunts held back: no taunt items", async () => {
    heldBack.taunts = false;
    await render();
    expect(keys().filter((k) => k!.startsWith("taunt:"))).toEqual([]);
    expect(keys()).toContain("cardTracker:wins");
  });

  it("card sub-tab lists paid card items only", async () => {
    await render();
    expect(keys()).not.toContain("cardBackground:bg_redplanet");
    expect(keys()).not.toContain("cardTitle:warmonger");
    expect(keys()).toContain("taunt:salute");
  });

  it("a tracker whose name isn't its stat is never sold", async () => {
    grid = document.createElement(
      "card-store-grid",
    ) as unknown as CardStoreGrid;
    grid.cosmetics = {
      ...COSMETICS,
      cardTrackers: {
        ...COSMETICS.cardTrackers,
        renamed: {
          product: null,
          rarity: "common",
          name: "renamed",
          stat: "conquests",
          priceSoft: 400,
        },
      },
    } as unknown as Cosmetics;
    document.body.appendChild(grid as unknown as Node);
    await grid.updateComplete;
    expect(keys()).toContain("cardTracker:wins");
    expect(keys()).not.toContain("cardTracker:renamed");
  });

  it("player card listed first, trackers after it", async () => {
    await render();
    expect(keys().slice(0, 2)).toEqual([
      "playerCard:standard",
      "cardTracker:wins",
    ]);
  });

  it("thumb preview renders the background", async () => {
    await render();
    const bg = (grid as unknown as Element).querySelector(
      "[data-card-store-item='cardBackground:bg_frontline'] player-card",
    );
    expect(bg?.getAttribute("size")).toBe("thumb");
  });

  it("store tiles stay still", async () => {
    await render();
    const cards = (grid as unknown as Element).querySelectorAll("player-card");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect((card as unknown as { animated: boolean }).animated).toBe(false);
    }
  });

  it("owned items show Owned, not a price", async () => {
    await render(["taunt:salute"]);
    const salute = (grid as unknown as Element).querySelector(
      "[data-card-store-item='taunt:salute']",
    )!;
    expect(salute.querySelector("purchase-button")).toBeNull();
    expect(salute.textContent).toContain("my_card.owned");
  });

  it("a sale that has ended shows the list price, not struck through", async () => {
    grid = document.createElement(
      "card-store-grid",
    ) as unknown as CardStoreGrid;
    grid.cosmetics = {
      ...COSMETICS,
      cardBackgrounds: {
        bg_ended: onSale("bg_ended", ENDED),
        bg_running: onSale("bg_running", RUNNING),
      },
    } as unknown as Cosmetics;
    document.body.appendChild(grid as unknown as Node);
    await grid.updateComplete;
    const button = (key: string) =>
      (grid as unknown as Element).querySelector(
        `[data-card-store-item='${key}'] purchase-button`,
      ) as unknown as PriceProps;
    expect(button("cardBackground:bg_ended")).toMatchObject({
      priceHard: 600,
      priceSoft: 6000,
      listPriceHard: null,
      listPriceSoft: null,
    });
    expect(button("cardBackground:bg_running")).toMatchObject({
      priceHard: 400,
      priceSoft: 4000,
      listPriceHard: 600,
      listPriceSoft: 6000,
    });
  });

  it("impressions tracked on the card sub-tab", async () => {
    const tracker = {
      observe: vi.fn(),
      click: vi.fn(),
      releaseDetached: vi.fn(),
    };
    await render([], tracker);
    expect(tracker.observe).toHaveBeenCalledWith(
      expect.anything(),
      "playerCard:standard",
      { kind: "tab", tab: "cosmetics", subTab: "card" },
    );
  });

  it("the placement schema knows the card sub-tab", () => {
    expect(StorePlacementSubTabSchema.safeParse("card").success).toBe(true);
  });
});
