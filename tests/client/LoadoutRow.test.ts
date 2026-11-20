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
vi.mock("../../src/client/Cosmetics", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Cosmetics")>()),
  purchaseCosmetic: vi.fn(),
}));

import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import {
  buildPlayerCardView,
  type PlayerCardView,
} from "../../src/client/components/card/PlayerCardModel";
import {
  type LoadoutItem,
  LoadoutRow,
  loadoutItems,
  promoChoice,
} from "../../src/client/hud/layers/LoadoutRow";

// Taunts and titles are held back (HeldBack.ts). The tests below exercise
// the code behind them with both switched on; the "held back" block turns
// them off again.
beforeEach(() => {
  heldBack.taunts = true;
  heldBack.titles = true;
});

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
  it("titles held back: the killer's title is never offered", () => {
    heldBack.titles = false;
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
      "taunt:salute",
    ]);
    expect(items.map((i) => i.type)).not.toContain("cardTitle");
    expect(items.map((i) => i.type)).toContain("cardTracker");
  });

  it("taunts held back: the killer's taunt is never offered", () => {
    heldBack.taunts = false;
    const items = loadoutItems(VOLT, COSMETICS, [
      "playerCard:standard",
      "cardBackground:bg_frontline",
    ]);
    expect(items.map((i) => i.type)).not.toContain("taunt");
  });

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

describe("the folded block's player count", () => {
  // On a phone the block folds to one line: "Get the look · 1 player ›".
  it("is plural-aware", async () => {
    const { default: IntlMessageFormat } = await import("intl-messageformat");
    const en = (await import("../../resources/lang/en.json")).default as {
      win_modal: Record<string, string>;
    };
    const format = (n: number) =>
      new IntlMessageFormat(en.win_modal.get_look_players, "en").format({
        n,
      });
    expect(format(1)).toBe("1 player");
    expect(format(3)).toBe("3 players");
  });
});

describe("promoChoice", () => {
  const base = {
    isWin: false,
    gamesPlayed: 10,
    inIframe: false,
    canWishlist: true,
    rand: 0.9,
    hasLooks: false,
  };
  it("tutorial still wins in first 3 games", () => {
    expect(promoChoice({ ...base, gamesPlayed: 2 })).toBe("tutorial");
  });
  it("steam and discord keep their turns", () => {
    expect(promoChoice({ ...base, rand: 0.1 })).toBe("steam");
    expect(promoChoice({ ...base, rand: 0.4 })).toBe("discord");
  });
  it("no look: the skins turn as today", () => {
    expect(promoChoice(base)).toBe("skins");
  });
  it("any look to get takes the slot, from every other promo", () => {
    const looks = { ...base, hasLooks: true };
    expect(promoChoice(looks)).toBe("loadout");
    expect(promoChoice({ ...looks, rand: 0.1 })).toBe("loadout");
    expect(promoChoice({ ...looks, rand: 0.4 })).toBe("loadout");
    expect(promoChoice({ ...looks, gamesPlayed: 2 })).toBe("loadout");
    expect(promoChoice({ ...looks, isWin: true })).toBe("loadout");
  });
  it("iframe keeps today's choice", () => {
    const iframe = { ...base, inIframe: true, hasLooks: true };
    expect(promoChoice(iframe)).toBe("steam");
    expect(promoChoice({ ...iframe, canWishlist: false })).toBe("discord");
  });
});

// One "Get the look" block: chips for each player (the killer first, then
// saved looks newest first) over one row of the selected player's items.
describe("<loadout-row>", () => {
  let row: LoadoutRow;
  afterEach(() => row?.remove());

  const tracker = () => ({
    observe: vi.fn(),
    click: vi.fn(),
    releaseDetached: vi.fn(),
    dispose: vi.fn(),
  });
  async function render(props: Partial<LoadoutRow>) {
    row = document.createElement("loadout-row") as unknown as LoadoutRow;
    Object.assign(row, { tracker: tracker(), ...props });
    document.body.appendChild(row as unknown as Node);
    await row.updateComplete;
  }
  const el = () => row as unknown as Element;
  const q = (s: string) => el().querySelector(s);
  const qa = (s: string) => [...el().querySelectorAll(s)];
  const chips = () =>
    qa("[data-look-chip]").map((c) => [
      c.getAttribute("data-look-chip"),
      c.getAttribute("aria-pressed"),
    ]);
  const shown = () =>
    qa("[data-loadout-item]").map((i) => i.getAttribute("data-loadout-item"));
  const look = (clientID: string, name: string, items: LoadoutItem[]) => ({
    clientID,
    name,
    items,
  });
  // Built per test: the held-back switches are set in beforeEach.
  const voltLook = () =>
    look("volt", "Volt", loadoutItems(VOLT, COSMETICS, []));
  const adaLook = () =>
    look(
      "ada",
      "Ada",
      loadoutItems(VOLT, COSMETICS, ["playerCard:standard", "taunt:salute"]),
    );

  it("renders nothing without a look", async () => {
    await render({ looks: [] });
    expect(q("[data-look-block]")).toBeNull();
  });

  it("one chip per player in order, the first selected", async () => {
    await render({ looks: [voltLook(), adaLook()] });
    expect(chips()).toEqual([
      ["volt", "true"],
      ["ada", "false"],
    ]);
    expect(q("[data-loadout-title]")!.textContent).toContain(
      "win_modal.get_the_look",
    );
  });

  it("one row of items, for the selected player", async () => {
    await render({ looks: [voltLook(), adaLook()] });
    expect(shown()).toEqual([
      "playerCard:standard",
      "cardBackground:bg_frontline",
      "taunt:salute",
    ]);
    (q("[data-look-chip='ada']") as HTMLButtonElement).click();
    await row.updateComplete;
    expect(chips()).toEqual([
      ["volt", "false"],
      ["ada", "true"],
    ]);
    expect(shown()).toEqual([
      "cardBackground:bg_frontline",
      "cardTitle:warmonger",
      "cardTracker:wins",
    ]);
  });

  it("folds to one line on a phone; tapping opens chips and items", async () => {
    await render({ looks: [voltLook(), adaLook()] });
    const fold = q("[data-look-fold]") as HTMLButtonElement;
    expect(fold.className).toContain("sm:hidden");
    expect(fold.textContent).toContain('win_modal.get_look_players:{"n":2}');
    const title = q("[data-loadout-title]")!;
    const items = q("[data-look-items]")!;
    // Hidden on a phone until opened; always shown from sm up.
    for (const part of [title, items]) {
      expect(part.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(part.className).toContain("sm:flex");
    }
    fold.click();
    await row.updateComplete;
    for (const part of [title, items]) {
      expect(part.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    }
    // Opened, the items scroll sideways in one row rather than stacking.
    expect(items.className).toContain("flex-nowrap");
    expect(items.className).toContain("overflow-x-auto");
  });

  it("earned item shows lock and unlock label, no buy button", async () => {
    await render({ looks: [adaLook()] });
    const title = q("[data-loadout-item='cardTitle:warmonger']")!;
    expect(title.textContent).toContain("FFA Diamond");
    expect(title.querySelector("purchase-button")).toBeNull();
  });

  it("impression tracked with card_loadout placement", async () => {
    const t = tracker();
    await render({ looks: [voltLook()], tracker: t });
    expect(t.observe).toHaveBeenCalledWith(
      expect.anything(),
      "cardBackground:bg_frontline",
      { kind: "card_loadout" },
    );
  });

  // A running sale (flash or not) shows the sale price with the list price
  // struck through, as in the Store; once it has ended, the list price.
  const onSale = (endsAt: string): LoadoutItem => ({
    type: "cardBackground" as const,
    item: {
      ...COSMETICS.cardBackgrounds!.bg_frontline,
      priceHard: 1800,
      listPriceHard: 2400,
      promotion: { percentOff: 25, endsAt, kind: "flash" },
    } as never,
    state: "buy" as const,
    priceHard: 1800,
  });
  const button = () =>
    q("purchase-button") as unknown as {
      priceHard: number | null;
      listPriceHard: number | null;
    };

  it("a running sale shows the sale price over the struck list price", async () => {
    const ends = new Date(Date.now() + 3_600_000).toISOString();
    await render({ looks: [look("volt", "Volt", [onSale(ends)])] });
    expect(button().priceHard).toBe(1800);
    expect(button().listPriceHard).toBe(2400);
  });

  it("a sale that has ended shows the list price, not struck", async () => {
    const ended = new Date(Date.now() - 1000).toISOString();
    await render({ looks: [look("volt", "Volt", [onSale(ended)])] });
    expect(button().priceHard).toBe(2400);
    expect(button().listPriceHard).toBeNull();
  });

  it("passes the sale to the button, so its end switches over live", async () => {
    vi.useFakeTimers();
    try {
      const ends = new Date(Date.now() + 60_000).toISOString();
      await render({ looks: [look("volt", "Volt", [onSale(ends)])] });
      const b = q("purchase-button") as unknown as {
        promotion: { endsAt: string } | null;
        shown(c: "hard"): { price: number; listPrice: number | null };
      };
      expect(b.promotion?.endsAt).toBe(ends);
      expect(b.shown("hard")).toMatchObject({ price: 1800, listPrice: 2400 });
      vi.advanceTimersByTime(61_000);
      // The button reads the price through shownPrice at the moment it shows.
      expect(b.shown("hard")).toMatchObject({ price: 2400, listPrice: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
