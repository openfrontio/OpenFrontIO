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

  it("a paid item shows its price", async () => {
    await render(userMe(OWNER, SAVED));
    const front = tile("cardBackground:bg_frontline");
    expect(front.dataset.state).toBe("buy");
    expect(front.querySelector("purchase-button")).not.toBeNull();
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
