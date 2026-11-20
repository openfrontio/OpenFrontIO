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
import { MyCardTab } from "../../src/client/components/card/MyCardTab";

// Taunts and titles are held back (HeldBack.ts). The tests below exercise
// the code behind them with both switched on; the "held back" block turns
// them off again.
beforeEach(() => {
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
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    await render(userMe(OWNER, { ...SAVED, taunt: "salute" }));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ background: "bg_pacific", taunt: "salute" }),
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
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    await render(userMe(OWNER, { ...SAVED, title: "warmonger" }));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ background: "bg_pacific", title: "warmonger" }),
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
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    await render(userMe(OWNER, SAVED));
    tile("cardBackground:bg_pacific").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith({
      background: "bg_pacific",
      title: null,
      taunt: null,
      trackers: ["wins", "nukes_launched", "best_elo"],
    });
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
    api.save.mockResolvedValue({ ok: true, loadout: {} });
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
    );
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

  it("a tracker is keyed on its stat, as the server checks it", async () => {
    // The catalogue's name and stat are equal today (infra builds stat from
    // the name), but the server and the saved loadout use the stat.
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    tab = document.createElement("my-card-tab") as unknown as MyCardTab;
    tab.userMe = userMe(["playerCard:standard", "cardTracker:conquests"], {
      ...SAVED,
      trackers: [],
    });
    tab.cosmetics = {
      ...COSMETICS,
      cardTrackers: {
        conquest_count: {
          product: null,
          rarity: "common",
          name: "conquest_count",
          stat: "conquests",
          priceSoft: 400,
        },
      },
    } as unknown as Cosmetics;
    document.body.appendChild(tab as unknown as Node);
    await tab.updateComplete;
    await openSlot("trackers");
    const conq = tile("cardTracker:conquest_count");
    expect(conq.dataset.state).toBe("owned");
    conq.click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ trackers: ["conquests"] }),
    );
    expect(tile("cardTracker:conquest_count").dataset.state).toBe("equipped");
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
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    await render(userMe(OWNER, SAVED));
    await openSlot("trackers");
    tile("cardTracker:wins").click();
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ trackers: ["nukes_launched", "best_elo"] }),
    );
  });

  it("reset restores saved loadout", async () => {
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    await render(userMe(OWNER, SAVED));
    tile("cardBackground:bg_pacific").click();
    await settle();
    (q("[data-my-card-reset]") as HTMLButtonElement).click();
    await settle();
    expect(api.save).toHaveBeenLastCalledWith({
      background: null,
      title: null,
      taunt: null,
      trackers: ["wins", "nukes_launched", "best_elo"],
    });
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
