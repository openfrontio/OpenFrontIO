import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("../../src/client/Cosmetics", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Cosmetics")>()),
  purchaseCosmetic: vi.fn(),
  purchaseCosmeticInPlace: vi.fn(),
  checkInPlacePurchase: vi.fn(async () => ({ ok: true, balance: 3000 })),
}));
const account = vi.hoisted(() => ({ publicId: "p1" as string | null }));
vi.mock("../../src/client/Auth", async (orig) => ({
  ...(await orig<typeof import("../../src/client/Auth")>()),
  currentPublicId: () => account.publicId,
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(false),
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
import { MAX_LOOK_ITEMS } from "../../src/client/components/card/LoadoutItems";
import {
  buildPlayerCardView,
  type PlayerCardView,
} from "../../src/client/components/card/PlayerCardModel";
import {
  checkInPlacePurchase,
  purchaseCosmeticInPlace,
} from "../../src/client/Cosmetics";
import {
  type LoadoutItem,
  LoadoutRow,
  loadoutItems,
  promoChoice,
  shownPrices,
} from "../../src/client/hud/layers/LoadoutRow";
import {
  showInGameAlert,
  showInGameConfirm,
} from "../../src/client/InGameModal";

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
    expect(items.map((i) => `${i.type}:${i.item.name}`).slice(0, 3)).toEqual([
      "playerCard:standard",
      "cardBackground:bg_frontline",
      "cardTracker:wins",
    ]);
  });

  // Uncapped: a saved look keeps every candidate, and the end screen caps
  // each row after its filters (endScreenLookRows).
  it("every candidate, not just three", () => {
    const items = loadoutItems(VOLT, COSMETICS, []);
    expect(items.map((i) => `${i.type}:${i.item.name}`)).toEqual([
      "playerCard:standard",
      "cardBackground:bg_frontline",
      "cardTracker:wins",
      "cardTracker:best_elo",
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

  it("earned item has an unlock label; a paid one is priced where shown", () => {
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
    expect(paid).toMatchObject({ state: "buy" });
    // Priced where it's shown, never from a snapshot on the item.
    expect(paid).not.toHaveProperty("priceHard");
    expect(paid).not.toHaveProperty("priceSoft");
    expect(shownPrices(paid).priceSoft).toBe(400);
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
    expect(bg.type).toBe("cardBackground");
    expect(shownPrices(bg)).toMatchObject({
      priceHard: 600,
      priceSoft: 6000,
      listPriceHard: null,
    });

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
    expect(shownPrices(live)).toMatchObject({
      priceHard: 400,
      listPriceHard: 600,
    });
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
    expect(shownPrices(wins)).toMatchObject({
      priceHard: null,
      priceSoft: 400,
    });
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
  // Capped as the end screen hands rows over (endScreenLookRows).
  const look = (clientID: string, name: string, items: LoadoutItem[]) => ({
    clientID,
    name,
    items: items.slice(0, MAX_LOOK_ITEMS),
  });
  const voltLook = () =>
    look("volt", "Volt", loadoutItems(VOLT, COSMETICS, []));
  const adaLook = () =>
    look("ada", "Ada", loadoutItems(VOLT, COSMETICS, ["playerCard:standard"]));

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
      "cardTracker:wins",
    ]);
    (q("[data-look-chip='ada']") as HTMLButtonElement).click();
    await row.updateComplete;
    expect(chips()).toEqual([
      ["volt", "false"],
      ["ada", "true"],
    ]);
    expect(shown()).toEqual([
      "cardBackground:bg_frontline",
      "cardTracker:wins",
      "cardTracker:best_elo",
    ]);
  });

  it("the selected player stays selected when a look is saved ahead of them", async () => {
    await render({ looks: [voltLook(), adaLook()] });
    (q("[data-look-chip='ada']") as HTMLButtonElement).click();
    await row.updateComplete;
    // A look saved meanwhile goes in newest first, after the killer.
    const bo = look("bo", "Bo", loadoutItems(VOLT, COSMETICS, []));
    row.looks = [voltLook(), bo, adaLook()];
    await row.updateComplete;
    expect(chips()).toEqual([
      ["volt", "false"],
      ["bo", "false"],
      ["ada", "true"],
    ]);
  });

  it("the selected player gone: the first is selected", async () => {
    await render({ looks: [voltLook(), adaLook()] });
    (q("[data-look-chip='ada']") as HTMLButtonElement).click();
    await row.updateComplete;
    row.looks = [voltLook()];
    await row.updateComplete;
    expect(chips()).toEqual([["volt", "true"]]);
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
    const earned = q("[data-loadout-item='cardTracker:best_elo']")!;
    expect(earned.textContent).toContain("FFA Diamond");
    expect(earned.querySelector("purchase-button")).toBeNull();
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

// Buying from the block: in place, never a reload (that would end the game).
describe("<loadout-row> buying", () => {
  let row: LoadoutRow;
  afterEach(() => {
    row?.remove();
    document.body.innerHTML = "";
    vi.mocked(purchaseCosmeticInPlace).mockReset();
    vi.mocked(showInGameAlert).mockClear();
    vi.mocked(showInGameConfirm).mockReset();
    vi.mocked(showInGameConfirm).mockResolvedValue(false);
  });

  const BG: LoadoutItem = {
    type: "cardBackground",
    item: COSMETICS.cardBackgrounds!.bg_frontline as never,
    state: "buy",
  };
  async function render(props: Partial<LoadoutRow>) {
    row = document.createElement("loadout-row") as unknown as LoadoutRow;
    Object.assign(row, {
      tracker: {
        observe: vi.fn(),
        click: vi.fn(),
        releaseDetached: vi.fn(),
        dispose: vi.fn(),
      },
      looks: [{ clientID: "volt", name: "Volt", items: [BG] }],
      ...props,
    });
    document.body.appendChild(row as unknown as Node);
    await row.updateComplete;
  }
  const q = (s: string) => (row as unknown as Element).querySelector(s);
  const button = () =>
    q("purchase-button") as unknown as {
      busyKey: string;
      preflight: ((m: "hard" | "soft") => Promise<unknown>) | null;
      onPurchaseHard: (shownAmount?: number) => Promise<unknown>;
    };

  it("the button checks fresh on tap and shares the item's busy key", async () => {
    await render({});
    await button().preflight!("hard");
    expect(checkInPlacePurchase).toHaveBeenCalledWith(
      expect.objectContaining({ key: "cardBackground:bg_frontline" }),
      "hard",
    );
    // One purchase in flight per item, across every button for it.
    expect(button().busyKey).toBe("cardBackground:bg_frontline");
  });

  it("buys in place and reports the item owned", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "owned",
      fresh: false,
    });
    await render({});
    const heard = vi.fn();
    (row as unknown as Element).addEventListener("look-owned", (e) =>
      heard((e as CustomEvent).detail),
    );
    await button().onPurchaseHard();
    expect(purchaseCosmeticInPlace).toHaveBeenCalledWith(
      expect.objectContaining({ key: "cardBackground:bg_frontline" }),
      "hard",
      { kind: "card_loadout" },
      expect.any(Function),
      "p1",
      undefined,
    );
    expect(heard).toHaveBeenCalledWith({ key: "cardBackground:bg_frontline" });
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  it("reports it owned when the buy says so, before the fresh profile lands", async () => {
    // purchaseCosmeticInPlace calls onOwned, then broadcasts the profile.
    const seen: string[] = [];
    const onUserMe = () => seen.push("broadcast");
    document.addEventListener("userMeResponse", onUserMe);
    vi.mocked(purchaseCosmeticInPlace).mockImplementation(
      async (_r, _m, _p, onOwned) => {
        onOwned?.();
        document.dispatchEvent(new CustomEvent("userMeResponse"));
        return { kind: "owned", fresh: false };
      },
    );
    await render({});
    (row as unknown as Element).addEventListener("look-owned", () =>
      seen.push("look-owned"),
    );
    await button().onPurchaseHard();
    document.removeEventListener("userMeResponse", onUserMe);
    // Once, and first.
    expect(seen).toEqual(["look-owned", "broadcast"]);
  });

  it("an owned item reads Owned ✓ in place of the button", async () => {
    await render({ owned: new Set(["cardBackground:bg_frontline"]) });
    expect(q("purchase-button")).toBeNull();
    const owned = q("[data-look-owned]")!;
    expect(owned.textContent).toContain("win_modal.look_owned");
    expect(owned.className).toMatch(/min-h-11/);
  });

  it("a failure says nothing was charged; the button stays to buy", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({ kind: "failed" });
    await render({});
    await button().onPurchaseHard();
    expect(showInGameAlert).toHaveBeenCalledWith(
      "win_modal.purchase_failed_not_charged",
    );
    expect(q("purchase-button")).not.toBeNull();
  });

  it("couldn't confirm: says to check the balance, not that nothing was charged", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "unconfirmed",
    });
    await render({});
    await button().onPurchaseHard();
    expect(showInGameAlert).toHaveBeenCalledWith(
      "win_modal.purchase_unconfirmed",
    );
  });

  it("charged other than the price shown: the Store's notice", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "owned",
      fresh: false,
      notice: "bought Frontline for 400 Plutonium",
    });
    await render({});
    await button().onPurchaseHard();
    expect(showInGameAlert).toHaveBeenCalledWith(
      "bought Frontline for 400 Plutonium",
    );
  });

  it("sends the price the confirm box showed", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({ kind: "handled" });
    await render({});
    await button().onPurchaseHard(400);
    expect(vi.mocked(purchaseCosmeticInPlace).mock.calls[0]?.[5]).toBe(400);
  });

  it("the buy is bound to the account the tap check confirmed", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "signed_out",
    });
    await render({});
    await button().preflight!("hard");
    // Another tab signs in to another account while the confirm is open.
    account.publicId = "p2";
    try {
      await button().onPurchaseHard();
    } finally {
      account.publicId = "p1";
    }
    expect(purchaseCosmeticInPlace).toHaveBeenCalledWith(
      expect.objectContaining({ key: "cardBackground:bg_frontline" }),
      "hard",
      { kind: "card_loadout" },
      expect.any(Function),
      "p1",
      undefined,
    );
    expect(showInGameConfirm).toHaveBeenCalledWith(
      "win_modal.sign_in_leaves_game",
      expect.anything(),
    );
  });

  it("a tap check with no known account binds the buy to none, not to whoever signs in next", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "signed_out",
    });
    await render({});
    account.publicId = null;
    try {
      await button().preflight!("hard");
      account.publicId = "p2";
      await button().onPurchaseHard();
    } finally {
      account.publicId = "p1";
    }
    expect(vi.mocked(purchaseCosmeticInPlace).mock.calls[0][4]).toBeNull();
  });

  it("signed out by the time of the buy: the sign-in prompt", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "signed_out",
    });
    await render({});
    await button().onPurchaseHard();
    expect(showInGameConfirm).toHaveBeenCalledWith(
      "win_modal.sign_in_leaves_game",
      expect.anything(),
    );
  });

  it("the tap check finds no session: the sign-in prompt, not a dead tap", async () => {
    vi.mocked(checkInPlacePurchase).mockResolvedValueOnce({
      ok: false,
      reason: "signed_out",
    });
    await render({});
    await button().preflight!("hard");
    await vi.waitFor(() =>
      expect(showInGameConfirm).toHaveBeenCalledWith(
        "win_modal.sign_in_leaves_game",
        expect.anything(),
      ),
    );
  });

  it("the tap check can't reach the server: says so", async () => {
    vi.mocked(checkInPlacePurchase).mockResolvedValueOnce({
      ok: false,
      reason: "unreachable",
    });
    await render({});
    await button().preflight!("hard");
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith(
        "win_modal.server_unreachable",
      ),
    );
  });

  it("the buy can't read the profile (a session, the network): says so", async () => {
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "unreachable",
    });
    await render({});
    await button().onPurchaseHard();
    expect(showInGameAlert).toHaveBeenCalledWith(
      "win_modal.server_unreachable",
    );
    expect(showInGameConfirm).not.toHaveBeenCalled();
  });

  it("a shortfall goes back to the button's box", async () => {
    const info = {
      currency: "Plutonium",
      shortfall: 100,
      item: "Frontline",
      canTopUp: true,
      leavesGame: true,
    };
    vi.mocked(purchaseCosmeticInPlace).mockResolvedValue({
      kind: "insufficient",
      info,
    });
    await render({});
    expect(await button().onPurchaseHard()).toEqual(info);
  });

  it("signed out: Sign in to buy, no buy buttons", async () => {
    await render({ signedIn: false });
    expect(q("purchase-button")).toBeNull();
    const signIn = q("[data-look-sign-in]") as HTMLButtonElement;
    expect(signIn.textContent).toContain("win_modal.sign_in_to_buy");
    expect(signIn.className).toMatch(/min-h-11/);
  });

  it("Sign in to buy warns that it leaves the game first", async () => {
    await render({ signedIn: false });
    const before = window.location.hash;
    (q("[data-look-sign-in]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(showInGameConfirm).toHaveBeenCalled());
    expect(vi.mocked(showInGameConfirm).mock.calls[0][0]).toBe(
      "win_modal.sign_in_leaves_game",
    );
    // Declined: still here.
    expect(window.location.hash).toBe(before);
  });

  it("going on to sign in opens the account page", async () => {
    vi.mocked(showInGameConfirm).mockResolvedValue(true);
    await render({ signedIn: false });
    (q("[data-look-sign-in]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(window.location.hash).toBe("#modal=account"));
    window.location.hash = "";
  });

  it("no text under 11px", async () => {
    await render({});
    expect((row as unknown as Element).innerHTML).not.toMatch(
      /text-\[(\d|10)px\]/,
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
