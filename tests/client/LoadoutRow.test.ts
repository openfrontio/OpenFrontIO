import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("../../src/client/Cosmetics", () => ({
  purchaseCosmetic: vi.fn(),
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
      trackers: [{ stat: "wins", value: 1204 }],
    },
  },
  COSMETICS,
);

describe("loadoutItems", () => {
  it("viewer without the card sees the card first", () => {
    const items = loadoutItems(VOLT, COSMETICS, []);
    expect(items.map((i) => `${i.type}:${i.item.name}`)).toEqual([
      "playerCard:standard",
      "cardBackground:bg_frontline",
      "taunt:salute",
    ]);
  });

  it("owned items skipped, trackers fill remaining slots", () => {
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
      "taunt:salute",
    ]);
    expect(items.map((i) => `${i.type}:${i.item.name}`)).toEqual([
      "cardTitle:warmonger",
      "cardTracker:wins",
    ]);
  });

  it("earned item has an unlock label, paid item its prices", () => {
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    const title = items.find((i) => i.type === "cardTitle")!;
    expect(title).toMatchObject({
      state: "earned",
      unlockLabel: "FFA Diamond",
    });
    const taunt = items.find((i) => i.type === "taunt")!;
    expect(taunt).toMatchObject({ state: "buy", priceSoft: 800 });
  });

  it("caps-only item shows a caps price", () => {
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    const taunt = items.find((i) => i.type === "taunt")!;
    expect(taunt.priceHard).toBeUndefined();
    expect(taunt.priceSoft).toBe(800);
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
        "taunt:salute",
      ]),
      tracker: {
        observe: vi.fn(),
        click: vi.fn(),
        releaseDetached: vi.fn(),
        dispose: vi.fn(),
      },
    });
    const title = q("[data-loadout-item='cardTitle:warmonger']")!;
    expect(title.textContent).toContain("FFA Diamond");
    expect(title.querySelector("purchase-button")).toBeNull();
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
