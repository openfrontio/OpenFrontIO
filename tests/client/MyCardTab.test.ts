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
const api = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: api.save,
}));
const cosmeticsMod = vi.hoisted(() => ({ purchase: vi.fn() }));
vi.mock("../../src/client/Cosmetics", () => ({
  purchaseCosmetic: cosmeticsMod.purchase,
  getPlayerCosmetics: async () => ({ flag: "/flags/gb.svg" }),
}));

import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { resetCardSavesForTests } from "../../src/client/CardSaveQueue";
import { MyCardTab } from "../../src/client/components/card/MyCardTab";

// Taunts and titles are held back (HeldBack.ts). The tests below exercise
// the code behind them with both switched on; the "held back" block turns
// them off again.
beforeEach(() => {
  resetCardSavesForTests();
  heldBack.taunts = true;
  heldBack.titles = true;
});

if (!customElements.get("my-card-tab")) {
  customElements.define("my-card-tab", MyCardTab);
}

const item = { product: null, rarity: "epic" };
const COSMETICS = {
  patterns: {},
  flags: {},
  playerCards: {
    standard: { ...item, name: "standard", priceHard: 300, priceSoft: 3000 },
  },
  cardTrackers: Object.fromEntries(
    ["wins", "games_played", "nukes_launched", "best_elo", "conquests"].map(
      (s) => [s, { ...item, name: s, stat: s, priceSoft: 400 }],
    ),
  ),
  cardBackgrounds: {
    bg_pacific: { ...item, name: "bg_pacific", url: "/bg/pacific.webp" },
    bg_frontline: {
      ...item,
      name: "bg_frontline",
      url: "/bg/frontline.webp",
      priceHard: 240,
    },
    bg_redplanet: {
      ...item,
      name: "bg_redplanet",
      url: "/bg/red.webp",
      unlockSource: { kind: "seasonFree", label: "Season 1 · free tier 20" },
    },
  },
  cardTitles: {},
  taunts: {},
} as unknown as Cosmetics;

function userMe(flares: string[], card: unknown): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "p1",
      username: "iamlewis",
      flares,
      card,
      currency: { hard: 1000, soft: 6550 },
      progress: { level: 80, prestige: 2, legend: false },
    },
  } as unknown as UserMeResponse;
}

const OWNER = [
  "playerCard:standard",
  "cardBackground:bg_pacific",
  "cardTracker:wins",
  "cardTracker:games_played",
  "cardTracker:nukes_launched",
  "cardTracker:best_elo",
];
const SAVED = {
  background: null,
  title: null,
  taunt: null,
  trackers: [
    { stat: "wins", value: 312 },
    { stat: "nukes_launched", value: 4880 },
    { stat: "best_elo", value: 1612 },
  ],
};

// A card item whose sale has ended, though the catalogue in hand still holds
// the sale price.
const ENDED = new Date(Date.now() - 60_000).toISOString();
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

describe("<my-card-tab>", () => {
  let tab: MyCardTab;
  beforeEach(() => {
    api.save.mockReset();
    cosmeticsMod.purchase.mockReset();
  });
  afterEach(() => tab?.remove());

  async function render(me: UserMeResponse) {
    tab = document.createElement("my-card-tab") as unknown as MyCardTab;
    tab.userMe = me;
    tab.cosmetics = COSMETICS;
    document.body.appendChild(tab as unknown as Node);
    await tab.updateComplete;
  }
  const el = () => tab as unknown as HTMLElement;
  const q = (s: string) => el().querySelector(s);
  async function settle() {
    await tab.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await tab.updateComplete;
  }
  async function openSlot(slot: string) {
    (q(`[data-my-card-slot='${slot}']`) as HTMLButtonElement).click();
    await settle();
  }
  const tile = (key: string) => q(`[data-card-item='${key}']`) as HTMLElement;

  it("taunts held back: no Taunt slot, even with a taunt saved", async () => {
    heldBack.taunts = false;
    await render(userMe(OWNER, { ...SAVED, taunt: "salute" }));
    expect(q("[data-my-card-slot='taunt']")).toBeNull();
    expect(q("[data-my-card-slot='background']")).not.toBeNull();
  });

  it("taunts held back: saving sends the saved taunt back unchanged", async () => {
    heldBack.taunts = false;
    api.save.mockImplementation(async (body: unknown) => ({
      ok: true,
      loadout: body,
    }));
    await render(userMe(OWNER, { ...SAVED, taunt: "salute" }));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ background: "bg_pacific", taunt: "salute" }),
      expect.any(Function),
    );
  });

  it("titles held back: no Title slot, even with a title saved", async () => {
    heldBack.titles = false;
    await render(userMe(OWNER, { ...SAVED, title: "warmonger" }));
    expect(q("[data-my-card-slot='title']")).toBeNull();
    expect(q("[data-my-card-slot='trackers']")).not.toBeNull();
  });

  it("titles held back: saving sends the saved title back unchanged", async () => {
    heldBack.titles = false;
    api.save.mockImplementation(async (body: unknown) => ({
      ok: true,
      loadout: body,
    }));
    await render(userMe(OWNER, { ...SAVED, title: "warmonger" }));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ background: "bg_pacific", title: "warmonger" }),
      expect.any(Function),
    );
  });

  it("titles switched on: the Title slot shows", async () => {
    await render(userMe(OWNER, SAVED));
    expect(q("[data-my-card-slot='title']")).not.toBeNull();
  });

  it("taunts switched on: the Taunt slot shows", async () => {
    await render(userMe(OWNER, SAVED));
    expect(q("[data-my-card-slot='taunt']")).not.toBeNull();
  });

  it("tab shows a live preview and both balances", async () => {
    await render(userMe(OWNER, SAVED));
    expect(q("player-card")).not.toBeNull();
    expect(q("[data-my-card-balance]")!.textContent).toContain(
      (1000).toLocaleString(),
    );
    expect(q("[data-my-card-balance]")!.textContent).toContain(
      (6550).toLocaleString(),
    );
  });

  it("equipping an owned background saves and updates preview", async () => {
    api.save.mockImplementation(async (body: unknown) => ({
      ok: true,
      loadout: body,
    }));
    await render(userMe(OWNER, SAVED));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      {
        background: "bg_pacific",
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
      expect.any(Function),
    );
    expect(tile("cardBackground:bg_pacific").dataset.state).toBe("equipped");
  });

  // A save the test answers when it chooses.
  function deferredSaves() {
    const calls: { body: unknown; answer: (ok: boolean) => void }[] = [];
    api.save.mockImplementation(
      (body: unknown) =>
        new Promise((resolve) =>
          calls.push({
            body,
            answer: (ok) =>
              resolve(
                ok
                  ? { ok: true, loadout: body }
                  : { ok: false, error: "failed" },
              ),
          }),
        ),
    );
    return calls;
  }

  it("quick clicks save one at a time, the last one carrying both", async () => {
    const calls = deferredSaves();
    await render(userMe(OWNER, SAVED));
    await openSlot("trackers");
    tile("cardTracker:wins").click();
    await settle();
    tile("cardTracker:nukes_launched").click();
    await settle();
    // The second waits for the first: two PUTs in flight could land in
    // either order, and each replaces the whole loadout.
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      trackers: ["nukes_launched", "best_elo"],
    });
    calls[0].answer(true);
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ trackers: ["best_elo"] });
    calls[1].answer(true);
    await settle();
    expect(tile("cardTracker:wins").dataset.state).toBe("owned");
    expect(tile("cardTracker:nukes_launched").dataset.state).toBe("owned");
    expect(q("[data-my-card-error]")).toBeNull();
  });

  it("a failed save rolls back to what the server last confirmed", async () => {
    const calls = deferredSaves();
    await render(userMe(OWNER, SAVED));
    await openSlot("trackers");
    tile("cardTracker:wins").click();
    await settle();
    calls[0].answer(true);
    await settle();
    tile("cardTracker:nukes_launched").click();
    await settle();
    calls[1].answer(false);
    await settle();
    // Wins stays off (confirmed); only the failed change is undone.
    expect(tile("cardTracker:wins").dataset.state).toBe("owned");
    expect(tile("cardTracker:nukes_launched").dataset.state).toBe("equipped");
    expect(q("[data-my-card-error]")).not.toBeNull();
  });

  it("a failure drops clicks queued behind it, matching the server", async () => {
    const calls = deferredSaves();
    await render(userMe(OWNER, SAVED));
    await openSlot("trackers");
    tile("cardTracker:wins").click();
    await settle();
    tile("cardTracker:nukes_launched").click();
    await settle();
    calls[0].answer(false);
    await settle();
    expect(calls).toHaveLength(1);
    expect(tile("cardTracker:wins").dataset.state).toBe("equipped");
    expect(tile("cardTracker:nukes_launched").dataset.state).toBe("equipped");
  });

  it("a fresh /users/@me mid-save doesn't undo the clicks in flight", async () => {
    const calls = deferredSaves();
    const me = userMe(OWNER, SAVED);
    await render(me);
    await openSlot("trackers");
    tile("cardTracker:wins").click();
    await settle();
    tab.userMe = { ...me } as UserMeResponse;
    await settle();
    expect(tile("cardTracker:wins").dataset.state).toBe("owned");
    calls[0].answer(true);
    await settle();
    expect(tile("cardTracker:wins").dataset.state).toBe("owned");
  });

  it("Reset still goes back to the opening loadout after a save's refresh", async () => {
    api.save.mockImplementation(async (body: unknown) => ({
      ok: true,
      loadout: body,
    }));
    const me = userMe(OWNER, SAVED);
    await render(me);
    tile("cardBackground:bg_pacific").click();
    await settle();
    // The refresh a save broadcasts.
    tab.userMe = {
      ...me,
      player: {
        ...me.player,
        card: { ...SAVED, background: "bg_pacific" },
      },
    } as unknown as UserMeResponse;
    await settle();
    (q("[data-my-card-reset]") as HTMLButtonElement).click();
    await settle();
    expect(api.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ background: null }),
      expect.any(Function),
    );
  });

  it("a superseded save's late answer is not taken, back in the same account", async () => {
    const calls = deferredSaves();
    const me = userMe(OWNER, SAVED);
    await render(me);
    const seen = vi.fn();
    el().addEventListener("card-saved", (e) => seen((e as CustomEvent).detail));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(calls).toHaveLength(1);
    // Signed out and back into the same account, then a newer save.
    document.dispatchEvent(new CustomEvent("session-cleared"));
    tab.userMe = { ...me } as UserMeResponse;
    await settle();
    await openSlot("trackers");
    tile("cardTracker:wins").click();
    await settle();
    expect(calls).toHaveLength(2);
    calls[1].answer(true);
    await settle();
    // The old run answers last.
    calls[0].answer(true);
    await settle();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({
      publicId: "p1",
      loadout: {
        background: null,
        title: null,
        taunt: null,
        trackers: ["nukes_launched", "best_elo"],
      },
    });
    expect(tile("cardTracker:wins").dataset.state).toBe("owned");
    await openSlot("background");
    expect(tile("cardBackground:bg_pacific").dataset.state).toBe("owned");
    expect(q("[data-my-card-error]")).toBeNull();
  });

  it("Reset never offers a loadout from a save that was dropped", async () => {
    // A tab opened mid-save resets to that save's loadout. Once the save is
    // dropped (a sign-out while it ran), Reset goes to what the server
    // confirmed instead.
    const calls = deferredSaves();
    const me = userMe(OWNER, SAVED);
    await render(me);
    tile("cardBackground:bg_pacific").click();
    await settle();
    tab.remove();
    await render(me);
    expect(tile("cardBackground:bg_pacific").dataset.state).toBe("equipped");
    document.dispatchEvent(new CustomEvent("session-cleared"));
    calls[0].answer(true);
    await settle();
    expect(tile("cardBackground:bg_pacific").dataset.state).toBe("owned");
    expect((q("[data-my-card-reset]") as HTMLButtonElement).hidden).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("takes the loadout the server stored, and tells the host", async () => {
    // The server's answer is the truth (it may drop or reorder): that is
    // what the tab holds and what it hands up in card-saved.
    const stored = {
      background: "bg_pacific",
      title: null,
      taunt: null,
      trackers: ["best_elo", "wins"],
    };
    api.save.mockResolvedValue({ ok: true, loadout: stored });
    await render(userMe(OWNER, SAVED));
    const seen = vi.fn();
    el().addEventListener("card-saved", (e) => seen((e as CustomEvent).detail));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(seen).toHaveBeenCalledWith({ publicId: "p1", loadout: stored });
    await openSlot("trackers");
    expect(tile("cardTracker:nukes_launched").dataset.state).toBe("owned");
    expect(tile("cardTracker:wins").dataset.state).toBe("equipped");
  });

  it("failed save rolls back", async () => {
    api.save.mockResolvedValue({ ok: false, error: "failed" });
    await render(userMe(OWNER, SAVED));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(tile("cardBackground:bg_pacific").dataset.state).toBe("owned");
    expect(q("[data-my-card-error]")).not.toBeNull();
  });

  it("locked earned item shows unlock label and no buy button", async () => {
    await render(userMe(OWNER, SAVED));
    const red = tile("cardBackground:bg_redplanet");
    expect(red.dataset.state).toBe("locked");
    expect(red.textContent).toContain("Season 1 · free tier 20");
    expect(red.querySelector("purchase-button")).toBeNull();
  });

  it("a sale that has ended shows the list price, not struck through", async () => {
    tab = document.createElement("my-card-tab") as unknown as MyCardTab;
    tab.userMe = userMe(OWNER, SAVED);
    tab.cosmetics = {
      ...COSMETICS,
      cardBackgrounds: { bg_ended: onSale("bg_ended", ENDED) },
    } as unknown as Cosmetics;
    document.body.appendChild(tab as unknown as Node);
    await tab.updateComplete;
    const button = tile("cardBackground:bg_ended").querySelector(
      "purchase-button",
    ) as unknown as PriceProps;
    expect(button).toMatchObject({
      priceHard: 600,
      priceSoft: 6000,
      listPriceHard: null,
      listPriceSoft: null,
    });
  });

  it("a sale that ends while on screen switches to the list price", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      tab = document.createElement("my-card-tab") as unknown as MyCardTab;
      tab.userMe = userMe(OWNER, SAVED);
      tab.cosmetics = {
        ...COSMETICS,
        cardBackgrounds: {
          bg_ending: onSale(
            "bg_ending",
            new Date(Date.now() + 5_000).toISOString(),
          ),
        },
      } as unknown as Cosmetics;
      document.body.appendChild(tab as unknown as Node);
      await tab.updateComplete;
      const button = tile("cardBackground:bg_ending").querySelector(
        "purchase-button",
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

  it("rarity labels are translated, 1 of 1 included", async () => {
    tab = document.createElement("my-card-tab") as unknown as MyCardTab;
    tab.userMe = userMe(OWNER, SAVED);
    tab.cosmetics = {
      ...COSMETICS,
      cardBackgrounds: {
        ...COSMETICS.cardBackgrounds,
        bg_bespoke: {
          product: null,
          rarity: "oneofone",
          name: "bg_bespoke",
          url: "/bg/bespoke.webp",
        },
      },
    } as unknown as Cosmetics;
    document.body.appendChild(tab as unknown as Node);
    await tab.updateComplete;
    const label = (key: string) =>
      tile(key).querySelector("[data-my-card-rarity]")?.textContent?.trim();
    expect(label("cardBackground:bg_pacific")).toBe("cosmetics.epic");
    expect(label("cardBackground:bg_bespoke")).toBe("cosmetics.oneofone");
    expect(tile("cardBackground:bg_bespoke").dataset.cosmeticRarity).toBe(
      "oneofone",
    );
  });

  it("a paid item shows its price", async () => {
    await render(userMe(OWNER, SAVED));
    const front = tile("cardBackground:bg_frontline");
    expect(front.dataset.state).toBe("buy");
    expect(front.querySelector("purchase-button")).not.toBeNull();
  });

  it("buys with no placement by default (the Account modal)", async () => {
    await render(userMe(OWNER, SAVED));
    const button = tile("cardBackground:bg_frontline").querySelector(
      "purchase-button",
    ) as unknown as { onPurchaseHard: () => Promise<unknown> };
    await button.onPurchaseHard();
    expect(cosmeticsMod.purchase).toHaveBeenCalledWith(
      expect.anything(),
      "hard",
      undefined,
    );
  });

  it("buys with the placement it is given (the Inventory)", async () => {
    tab = document.createElement("my-card-tab") as unknown as MyCardTab;
    tab.userMe = userMe(OWNER, SAVED);
    tab.cosmetics = COSMETICS;
    tab.placement = { kind: "inventory", subTab: "card" };
    document.body.appendChild(tab as unknown as Node);
    await tab.updateComplete;
    const button = tile("cardBackground:bg_frontline").querySelector(
      "purchase-button",
    ) as unknown as { onPurchaseSoft: () => Promise<unknown> };
    await button.onPurchaseSoft();
    expect(cosmeticsMod.purchase).toHaveBeenCalledWith(
      expect.anything(),
      "soft",
      { kind: "inventory", subTab: "card" },
    );
  });

  it("a tracker whose name isn't its stat is never offered", async () => {
    // One rule everywhere (PR 4's inventory too): infra grants the flare as
    // cardTracker:<name> and the API names every tracker by its stat, so a
    // tracker where they differ could be bought but never shown.
    await render(userMe([...OWNER, "cardTracker:renamed"], SAVED));
    tab.cosmetics = {
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
    await tab.updateComplete;
    await openSlot("trackers");
    expect(q("[data-card-item='cardTracker:renamed']")).toBeNull();
    expect(tile("cardTracker:conquests")).not.toBeNull();
  });

  it("fourth tracker is disabled", async () => {
    await render(userMe(OWNER, SAVED));
    await openSlot("trackers");
    const games = tile("cardTracker:games_played") as HTMLButtonElement;
    expect(games.hasAttribute("disabled")).toBe(true);
    expect(tile("cardTracker:wins").dataset.state).toBe("equipped");
  });

  it("unowned tracker shows price and can't be picked", async () => {
    await render(userMe(OWNER, SAVED));
    await openSlot("trackers");
    const conq = tile("cardTracker:conquests");
    expect(conq.dataset.state).toBe("buy");
    expect(conq.querySelector("purchase-button")).not.toBeNull();
  });

  it("unpicking a tracker saves the rest", async () => {
    api.save.mockImplementation(async (body: unknown) => ({
      ok: true,
      loadout: body,
    }));
    await render(userMe(OWNER, SAVED));
    await openSlot("trackers");
    tile("cardTracker:wins").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ trackers: ["nukes_launched", "best_elo"] }),
      expect.any(Function),
    );
  });

  it("reset restores saved loadout", async () => {
    api.save.mockImplementation(async (body: unknown) => ({
      ok: true,
      loadout: body,
    }));
    await render(userMe(OWNER, SAVED));
    tile("cardBackground:bg_pacific").click();
    await settle();
    (q("[data-my-card-reset]") as HTMLButtonElement).click();
    await settle();
    expect(api.save).toHaveBeenLastCalledWith(
      {
        background: null,
        title: null,
        taunt: null,
        trackers: ["wins", "nukes_launched", "best_elo"],
      },
      expect.any(Function),
    );
    expect(tile("cardBackground:bg_pacific").dataset.state).toBe("owned");
  });

  it("without the card: buy-card button shown, equip disabled", async () => {
    await render(userMe(["cardBackground:bg_pacific"], null));
    expect(q("[data-my-card-get-card] purchase-button")).not.toBeNull();
    const pacific = tile("cardBackground:bg_pacific") as HTMLButtonElement;
    expect(pacific.hasAttribute("disabled")).toBe(true);
    expect(el().textContent).toContain("my_card.needs_card");
  });
});
