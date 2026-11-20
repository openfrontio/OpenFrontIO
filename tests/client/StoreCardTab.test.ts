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

// A Store link to a card item (#modal=store&tab=cosmetics&item=<type>:<name>,
// after a top-up from the end screen): the Card sub-tab opens with that item
// selected, scrolled to, and its Buy focused, ready in one tap.
describe("<card-store-grid> opened on an item", () => {
  // jsdom has no scrollIntoView to spy on.
  beforeEach(() => {
    Element.prototype.scrollIntoView ??= () => {};
  });
  let grid: CardStoreGrid;
  let scrolled: Element[];
  afterEach(() => {
    grid?.remove();
    vi.restoreAllMocks();
  });

  async function render(requestedItem: string | null) {
    scrolled = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    grid = document.createElement(
      "card-store-grid",
    ) as unknown as CardStoreGrid;
    grid.cosmetics = COSMETICS;
    grid.requestedItem = requestedItem;
    document.body.appendChild(grid as unknown as Node);
    await grid.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await grid.updateComplete;
  }
  const tile = (key: string) =>
    (grid as unknown as Element).querySelector<HTMLElement>(
      `[data-card-store-item='${key}']`,
    )!;

  it("selects, scrolls to and focuses the Buy of a non-first item", async () => {
    const shown = vi.fn();
    document.addEventListener("requested-item-shown", shown);
    await render("cardBackground:bg_frontline");
    document.removeEventListener("requested-item-shown", shown);
    const t = tile("cardBackground:bg_frontline");
    // Not the first tile: the player card comes first.
    expect(
      (grid as unknown as Element).querySelector("[data-card-store-item]"),
    ).not.toBe(t);
    expect(t.hasAttribute("data-card-store-selected")).toBe(true);
    expect(t.className).toMatch(/ring-/);
    expect(scrolled).toContain(t);
    // The focused control is this item's Buy.
    expect(t.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.className).toMatch(/purchase-sparkle-btn/);
    // The Store hears it was shown, so it stops asking.
    expect(shown).toHaveBeenCalled();
  });

  it("only that item is selected", async () => {
    await render("cardBackground:bg_frontline");
    const selected = (grid as unknown as Element).querySelectorAll(
      "[data-card-store-selected]",
    );
    expect(selected).toHaveLength(1);
  });

  it("no request: nothing selected, nothing moved", async () => {
    await render(null);
    expect(
      (grid as unknown as Element).querySelector("[data-card-store-selected]"),
    ).toBeNull();
    expect(scrolled).toEqual([]);
  });

  it("waits for the catalogue: selects once the item shows", async () => {
    grid = document.createElement(
      "card-store-grid",
    ) as unknown as CardStoreGrid;
    scrolled = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
      this: Element,
    ) {
      scrolled.push(this);
    });
    grid.cosmetics = null;
    grid.requestedItem = "cardTracker:wins";
    document.body.appendChild(grid as unknown as Node);
    await grid.updateComplete;
    expect(scrolled).toEqual([]);
    grid.cosmetics = COSMETICS;
    await grid.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await grid.updateComplete;
    expect(
      tile("cardTracker:wins").hasAttribute("data-card-store-selected"),
    ).toBe(true);
  });

  it("handled requests clear the selection, so the same item can be asked for again", async () => {
    await render("cardBackground:bg_frontline");
    grid.requestedItem = null;
    await grid.updateComplete;
    expect(
      (grid as unknown as Element).querySelector("[data-card-store-selected]"),
    ).toBeNull();
    scrolled = [];
    grid.requestedItem = "cardBackground:bg_frontline";
    await grid.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await grid.updateComplete;
    expect(
      tile("cardBackground:bg_frontline").hasAttribute(
        "data-card-store-selected",
      ),
    ).toBe(true);
    expect(scrolled).toContain(tile("cardBackground:bg_frontline"));
  });
});
