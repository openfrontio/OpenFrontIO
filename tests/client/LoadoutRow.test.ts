import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("../../src/client/Cosmetics", () => ({
  purchaseCosmetic: vi.fn(),
}));
// The row's own tracker, counted: made, and disposed.
const trackers = vi.hoisted(() => ({
  made: [] as { disposed: boolean }[],
}));
vi.mock("../../src/client/StoreTracking", () => ({
  StoreTracker: class {
    disposed = false;
    constructor() {
      trackers.made.push(this);
    }
    observe() {}
    click() {}
    releaseDetached() {}
    dispose() {
      this.disposed = true;
    }
  },
}));

import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import {
  buildPlayerCardView,
  type PlayerCardView,
} from "../../src/client/components/card/PlayerCardModel";
import {
  LoadoutRow,
  loadoutItems,
  promoChoice,
} from "../../src/client/hud/layers/LoadoutRow";

if (!customElements.get("loadout-row")) {
  customElements.define("loadout-row", LoadoutRow);
}

const item = { product: null };
const COSMETICS = {
  patterns: {},
  flags: {},
  playerCards: {
    standard: { ...item, rarity: "common", name: "standard", priceHard: 300 },
  },
  cardTrackers: {
    wins: {
      ...item,
      rarity: "common",
      name: "wins",
      stat: "wins",
      priceSoft: 400,
    },
    best_elo: {
      ...item,
      rarity: "rare",
      name: "best_elo",
      stat: "best_elo",
      unlockSource: { kind: "elo", label: "FFA Diamond" },
    },
  },
  cardBackgrounds: {
    bg_frontline: {
      ...item,
      rarity: "legendary",
      name: "bg_frontline",
      url: "/bg.webp",
      priceHard: 2400,
    },
  },
  cardTitles: {
    warmonger: {
      ...item,
      rarity: "rare",
      name: "warmonger",
      text: "Warmonger",
      unlockSource: { kind: "elo", label: "FFA Diamond" },
    },
  },
  taunts: {
    salute: {
      ...item,
      rarity: "epic",
      name: "salute",
      tauntKind: "icon",
      preset: "salute",
      priceSoft: 800,
    },
  },
} as unknown as Cosmetics;

const VOLT: PlayerCardView = buildPlayerCardView(
  {
    username: "Volt",
    clanTag: "UN",
    badge: null,
    card: {
      background: "bg_frontline",
      title: "warmonger",
      taunt: "salute",
      trackers: [
        { stat: "wins", value: 1204 },
        { stat: "best_elo", value: 1840 },
      ],
    },
  },
  COSMETICS,
);

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

describe("loadoutItems", () => {
  it("the killer's title and taunt are never offered (held back)", () => {
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    expect(items.map((i) => i.type)).toEqual(["cardTracker", "cardTracker"]);
  });

  it("viewer without the card sees the card first", () => {
    const items = loadoutItems(VOLT, COSMETICS, []);
    expect(items.map((i) => `${i.type}:${i.item.name}`)).toEqual([
      "playerCard:standard",
      "cardBackground:bg_frontline",
      "cardTracker:wins",
    ]);
  });

  it("owned items skipped, trackers fill remaining slots", () => {
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    expect(items.map((i) => `${i.type}:${i.item.name}`)).toEqual([
      "cardTracker:wins",
      "cardTracker:best_elo",
    ]);
  });

  it("earned item has an unlock label, paid item its prices", () => {
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    const earned = items.find((i) => i.item.name === "best_elo")!;
    expect(earned).toMatchObject({
      state: "earned",
      unlockLabel: "FFA Diamond",
    });
    const paid = items.find((i) => i.item.name === "wins")!;
    expect(paid).toMatchObject({ state: "buy", priceSoft: 400 });
  });

  it("a sale that has ended offers the list price", () => {
    const cosmetics = {
      ...COSMETICS,
      cardBackgrounds: { bg_ended: onSale("bg_ended", ENDED) },
    } as unknown as Cosmetics;
    const view = buildPlayerCardView(
      {
        username: "Volt",
        clanTag: null,
        badge: null,
        card: { background: "bg_ended", trackers: [] },
      },
      cosmetics,
    );
    const [bg] = loadoutItems(view, cosmetics, ["playerCard:standard"]);
    expect(bg).toMatchObject({
      type: "cardBackground",
      priceHard: 600,
      priceSoft: 6000,
    });
    expect(bg.listPriceHard).toBeUndefined();

    const running = {
      ...COSMETICS,
      cardBackgrounds: { bg_running: onSale("bg_running", RUNNING) },
    } as unknown as Cosmetics;
    const [live] = loadoutItems(
      buildPlayerCardView(
        {
          username: "Volt",
          clanTag: null,
          badge: null,
          card: { background: "bg_running", trackers: [] },
        },
        running,
      ),
      running,
      ["playerCard:standard"],
    );
    expect(live).toMatchObject({ priceHard: 400, listPriceHard: 600 });
  });

  it("a tracker whose name isn't its stat is never offered", () => {
    const cosmetics = {
      ...COSMETICS,
      cardTrackers: {
        wins: {
          product: null,
          rarity: "common",
          name: "wins",
          stat: "games_played",
          priceSoft: 400,
        },
      },
    } as unknown as Cosmetics;
    const items = loadoutItems(VOLT, cosmetics, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    expect(items.map((i) => i.type)).not.toContain("cardTracker");
  });

  it("caps-only item shows a caps price", () => {
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    const wins = items.find((i) => i.item.name === "wins")!;
    expect(wins.priceHard).toBeUndefined();
    expect(wins.priceSoft).toBe(400);
  });
});

describe("promoChoice", () => {
  const base = {
    isWin: false,
    gamesPlayed: 10,
    inIframe: false,
    canWishlist: true,
    rand: 0.9,
    hasLoadout: true,
    eliminatedByCard: true,
  };
  it("tutorial still wins in first 3 games", () => {
    expect(promoChoice({ ...base, gamesPlayed: 2 })).toBe("tutorial");
  });
  it("steam and discord keep their turns", () => {
    expect(promoChoice({ ...base, rand: 0.1 })).toBe("steam");
    expect(promoChoice({ ...base, rand: 0.4 })).toBe("discord");
  });
  it("loadout takes skins turn on elimination", () => {
    expect(promoChoice(base)).toBe("loadout");
  });
  it("no paid items falls back to skins", () => {
    expect(promoChoice({ ...base, hasLoadout: false })).toBe("skins");
  });
  it("winner screen never shows loadout", () => {
    expect(promoChoice({ ...base, eliminatedByCard: false })).toBe("skins");
  });
  it("iframe keeps today's choice", () => {
    expect(promoChoice({ ...base, inIframe: true })).toBe("steam");
    expect(promoChoice({ ...base, inIframe: true, canWishlist: false })).toBe(
      "discord",
    );
  });
});

describe("<loadout-row>", () => {
  let row: LoadoutRow;
  afterEach(() => row?.remove());

  async function render(props: Partial<LoadoutRow>) {
    row = document.createElement("loadout-row") as unknown as LoadoutRow;
    Object.assign(row, props);
    document.body.appendChild(row as unknown as Node);
    await row.updateComplete;
  }
  const q = (s: string) => (row as unknown as Element).querySelector(s);
  const qa = (s: string) => [
    ...(row as unknown as Element).querySelectorAll(s),
  ];

  it("shows up to three items with the killer's name", async () => {
    const tracker = {
      observe: vi.fn(),
      click: vi.fn(),
      releaseDetached: vi.fn(),
      dispose: vi.fn(),
    };
    await render({
      ownerName: "Volt",
      items: loadoutItems(VOLT, COSMETICS, []),
      tracker,
    });
    expect(q("[data-loadout-title]")!.textContent).toContain(
      'win_modal.get_look:{"name":"Volt"}',
    );
    expect(qa("[data-loadout-item]")).toHaveLength(3);
  });

  it("earned item shows lock and unlock label, no buy button", async () => {
    await render({
      ownerName: "Volt",
      items: loadoutItems(VOLT, COSMETICS, [
        "playerCard:standard",
        "cardBackground:bg_frontline",
      ]),
      tracker: {
        observe: vi.fn(),
        click: vi.fn(),
        releaseDetached: vi.fn(),
        dispose: vi.fn(),
      },
    });
    const earned = q("[data-loadout-item='cardTracker:best_elo']")!;
    expect(earned.textContent).toContain("FFA Diamond");
    expect(earned.querySelector("purchase-button")).toBeNull();
  });

  it("a sale that ends while on screen switches to the list price", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const cosmetics = {
        ...COSMETICS,
        cardBackgrounds: {
          bg_ending: onSale(
            "bg_ending",
            new Date(Date.now() + 5_000).toISOString(),
          ),
        },
      } as unknown as Cosmetics;
      const view = buildPlayerCardView(
        {
          username: "Volt",
          clanTag: null,
          badge: null,
          card: { background: "bg_ending", trackers: [] },
        },
        cosmetics,
      );
      await render({
        ownerName: "Volt",
        items: loadoutItems(view, cosmetics, ["playerCard:standard"]),
        tracker: {
          observe: vi.fn(),
          click: vi.fn(),
          releaseDetached: vi.fn(),
          dispose: vi.fn(),
        },
      });
      const button = q(
        "[data-loadout-item='cardBackground:bg_ending'] purchase-button",
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

  it("impression tracked with card_loadout placement", async () => {
    const tracker = {
      observe: vi.fn(),
      click: vi.fn(),
      releaseDetached: vi.fn(),
      dispose: vi.fn(),
    };
    await render({
      ownerName: "Volt",
      items: loadoutItems(VOLT, COSMETICS, []),
      tracker,
    });
    expect(tracker.observe).toHaveBeenCalledWith(
      expect.anything(),
      "cardBackground:bg_frontline",
      { kind: "card_loadout" },
    );
  });
});

describe("<loadout-row> owned tracker", () => {
  beforeEach(() => {
    trackers.made.length = 0;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("a row removed before the tracker loads never makes one", async () => {
    const row = document.createElement("loadout-row") as unknown as LoadoutRow;
    document.body.appendChild(row as unknown as Node);
    (row as unknown as Element).remove();
    await settle();
    expect(trackers.made.filter((t) => !t.disposed)).toHaveLength(0);
  });

  it("disposes its tracker on removal and makes a new one when reattached", async () => {
    const row = document.createElement("loadout-row") as unknown as LoadoutRow;
    document.body.appendChild(row as unknown as Node);
    await settle();
    expect(trackers.made).toHaveLength(1);
    (row as unknown as Element).remove();
    expect(trackers.made[0].disposed).toBe(true);
    document.body.appendChild(row as unknown as Node);
    await settle();
    expect(trackers.made).toHaveLength(2);
    expect(row.tracker).toBe(trackers.made[1]);
    (row as unknown as Element).remove();
  });
});
