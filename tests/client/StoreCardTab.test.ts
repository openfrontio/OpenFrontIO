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
import { purchaseCosmetic } from "../../src/client/Cosmetics";
import { shownPrice } from "../../src/client/ShownPrice";

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

  it("no title items, even a sold one (held back)", async () => {
    await render();
    expect(keys().filter((k) => k!.startsWith("cardTitle:"))).toEqual([]);
    expect(keys()).toContain("cardTracker:wins");
  });

  it("no taunt items, even a sold one (held back)", async () => {
    await render();
    expect(keys().filter((k) => k!.startsWith("taunt:"))).toEqual([]);
    expect(keys()).toContain("cardTracker:wins");
  });

  it("card sub-tab lists paid card items only", async () => {
    await render();
    expect(keys()).not.toContain("cardBackground:bg_redplanet");
    expect(keys()).toContain("cardBackground:bg_frontline");
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

  it("without the card: the card comes first and the rest say they need it", async () => {
    await render([]);
    expect(keys()[0]).toBe("playerCard:standard");
    const note = (key: string) =>
      (grid as unknown as Element).querySelector(
        `[data-card-store-item='${key}'] [data-card-store-needs-card]`,
      );
    expect(note("playerCard:standard")).toBeNull();
    expect(note("cardBackground:bg_frontline")!.textContent).toContain(
      "store.card_item_needs_card",
    );
    expect(note("cardTracker:wins")).not.toBeNull();
  });

  it("with the card: no note", async () => {
    await render(["playerCard:standard"]);
    expect(
      (grid as unknown as Element).querySelector(
        "[data-card-store-needs-card]",
      ),
    ).toBeNull();
  });

  it("owned items show Owned, not a price", async () => {
    await render(["cardTracker:wins"]);
    const wins = (grid as unknown as Element).querySelector(
      "[data-card-store-item='cardTracker:wins']",
    )!;
    expect(wins.querySelector("purchase-button")).toBeNull();
    expect(wins.textContent).toContain("my_card.owned");
  });

  it("sends the price the confirm box showed, even if the catalogue changes while it is open", async () => {
    await render(["playerCard:standard"]);
    const button = (grid as unknown as Element).querySelector(
      "[data-card-store-item='cardBackground:bg_frontline'] purchase-button",
    ) as unknown as HTMLElement & {
      requestCurrencyPurchase(method: "hard"): void;
      updateComplete: Promise<unknown>;
    };
    button.requestCurrencyPurchase("hard");
    await button.updateComplete;
    // A new catalogue lands while the box is open (a cohort reload).
    const raised = structuredClone(COSMETICS) as Cosmetics;
    (raised.cardBackgrounds!.bg_frontline as { priceHard: number }).priceHard =
      2600;
    grid.cosmetics = raised;
    await grid.updateComplete;
    button
      .querySelector("confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));
    await new Promise((r) => setTimeout(r, 0));
    expect(vi.mocked(purchaseCosmetic)).toHaveBeenCalledWith(
      expect.objectContaining({ key: "cardBackground:bg_frontline" }),
      "hard",
      expect.anything(),
      2400,
    );
  });

  it("a sale that ends while on screen switches to the list price", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      grid = document.createElement(
        "card-store-grid",
      ) as unknown as CardStoreGrid;
      grid.cosmetics = {
        ...COSMETICS,
        cardBackgrounds: {
          bg_ending: onSale(
            "bg_ending",
            new Date(Date.now() + 5_000).toISOString(),
          ),
        },
      } as unknown as Cosmetics;
      document.body.appendChild(grid as unknown as Node);
      await grid.updateComplete;
      const button = (grid as unknown as Element).querySelector(
        "[data-card-store-item='cardBackground:bg_ending'] purchase-button",
      )!;
      expect(button.querySelector("[data-sale-tag]")).not.toBeNull();
      expect(button.textContent).toContain("400");
      vi.advanceTimersByTime(5_010);
      await (button as unknown as { updateComplete: Promise<unknown> })
        .updateComplete;
      expect(button.querySelector("[data-sale-tag]")).toBeNull();
      expect(button.textContent).toContain("600");
      expect(button.textContent).not.toContain("400");
    } finally {
      vi.useRealTimers();
    }
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
    // The button gets the sale with its prices and shows them through
    // shownPrice, so check what it shows.
    const shown = (key: string, currency: "hard" | "soft") => {
      const b = (grid as unknown as Element).querySelector(
        `[data-card-store-item='${key}'] purchase-button`,
      ) as unknown as PriceProps & { promotion: { endsAt: string } | null };
      return shownPrice(
        {
          priceHard: b.priceHard ?? undefined,
          priceSoft: b.priceSoft ?? undefined,
          listPriceHard: b.listPriceHard ?? undefined,
          listPriceSoft: b.listPriceSoft ?? undefined,
          promotion: b.promotion ?? undefined,
        },
        currency,
      );
    };
    expect(shown("cardBackground:bg_ended", "hard")).toMatchObject({
      price: 600,
      listPrice: null,
    });
    expect(shown("cardBackground:bg_ended", "soft")).toMatchObject({
      price: 6000,
      listPrice: null,
    });
    expect(shown("cardBackground:bg_running", "hard")).toMatchObject({
      price: 400,
      listPrice: 600,
    });
    expect(shown("cardBackground:bg_running", "soft")).toMatchObject({
      price: 4000,
      listPrice: 6000,
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

describe("<card-store-grid> preview and live prices", () => {
  let grid: CardStoreGrid;
  afterEach(() => grid?.remove());
  async function render(cosmetics: Cosmetics = COSMETICS) {
    grid = document.createElement(
      "card-store-grid",
    ) as unknown as CardStoreGrid;
    grid.cosmetics = cosmetics;
    grid.username = "iamlewis";
    document.body.appendChild(grid as unknown as Node);
    await grid.updateComplete;
  }
  const el = () => grid as unknown as Element;

  it("clicking an item's preview opens the large animated preview", async () => {
    await render();
    expect(el().querySelector("card-item-preview")).toBeNull();
    el()
      .querySelector<HTMLButtonElement>(
        "[data-card-store-item='cardBackground:bg_frontline'] [data-card-store-preview]",
      )!
      .click();
    await grid.updateComplete;
    const preview = el().querySelector("card-item-preview")!;
    const card = preview.querySelector("player-card") as unknown as {
      animated: boolean;
      view: { username: string; background: { name: string } | null };
    };
    expect(card.animated).toBe(true);
    expect(card.view.background?.name).toBe("bg_frontline");
    expect(card.view.username).toBe("iamlewis");
  });

  it("trackers and the card itself preview too", async () => {
    await render();
    for (const key of ["cardTracker:wins", "playerCard:standard"]) {
      expect(
        el().querySelector(
          `[data-card-store-item='${key}'] [data-card-store-preview]`,
        ),
      ).not.toBeNull();
    }
  });

  it("passes each item's sale to its buy button, so the price changes when it ends", async () => {
    const promotion = {
      name: "Storm week",
      percentOff: 50,
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const onSale = structuredClone(COSMETICS) as Cosmetics;
    Object.assign(
      (onSale.cardBackgrounds as Record<string, object>).bg_frontline,
      { priceHard: 1200, listPriceHard: 2400, promotion },
    );
    await render(onSale);
    const button = el().querySelector(
      "[data-card-store-item='cardBackground:bg_frontline'] purchase-button",
    ) as unknown as { promotion: unknown };
    expect(button.promotion).toEqual(promotion);
  });
});
