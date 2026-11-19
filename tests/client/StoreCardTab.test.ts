import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("../../src/client/Cosmetics", () => ({
  purchaseCosmetic: vi.fn(),
}));

import { StorePlacementSubTabSchema } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { CardStoreGrid } from "../../src/client/components/card/CardStoreGrid";

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

  it("card sub-tab lists paid card items only", async () => {
    await render();
    expect(keys()).not.toContain("cardBackground:bg_redplanet");
    expect(keys()).not.toContain("cardTitle:warmonger");
    expect(keys()).toContain("taunt:salute");
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
