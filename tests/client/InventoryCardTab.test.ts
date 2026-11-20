import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
const api = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: api.save,
}));
const shop = vi.hoisted(() => ({
  buy: vi.fn(),
  check: vi.fn(),
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  purchaseCosmeticInPlace: shop.buy,
  checkInPlacePurchase: shop.check,
}));

import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { CardEditor } from "../../src/client/components/inventory/CardDraft";
import "../../src/client/components/inventory/InventoryCardTab";
import type { InventoryCardTab } from "../../src/client/components/inventory/InventoryCardTab";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";

const item = { product: null, rarity: "common" };
const LATER = () => new Date(Date.now() + 3_600_000).toISOString();
const COSMETICS = {
  patterns: {},
  flags: {},
  playerCards: {
    standard: { ...item, name: "standard", priceHard: 300, priceSoft: 30000 },
  },
  cardTrackers: Object.fromEntries(
    ["wins", "games_played", "nukes_launched", "best_elo", "conquests"].map(
      (s) => [s, { ...item, name: s, stat: s, priceSoft: 400 }],
    ),
  ),
  cardBackgrounds: {
    bg_pacific: { ...item, name: "bg_pacific", url: "/bg/pacific.webp" },
    bg_storm: {
      ...item,
      rarity: "epic",
      name: "bg_storm",
      url: "/bg/storm.webp",
      priceHard: 240,
      priceSoft: 2400,
    },
    bg_neon: {
      ...item,
      name: "bg_neon",
      url: "/bg/neon.webp",
      priceSoft: 900,
    },
    bg_redplanet: {
      ...item,
      name: "bg_redplanet",
      url: "/bg/red.webp",
      unlockSource: { kind: "seasonFree", label: "Season 1 · free tier 20" },
    },
  },
  cardTitles: {},
  taunts: {
    salute: { ...item, name: "salute", tauntKind: "icon", preset: "salute" },
  },
} as unknown as Cosmetics;

const OWNER = [
  "playerCard:standard",
  "cardBackground:bg_pacific",
  "cardTracker:wins",
  "cardTracker:games_played",
  "cardTracker:nukes_launched",
  "cardTracker:best_elo",
];
const SAVED = {
  background: "bg_pacific",
  title: "warmonger",
  taunt: "salute",
  trackers: [
    { stat: "wins", value: 312 },
    { stat: "nukes_launched", value: 4880 },
    { stat: "best_elo", value: 1612 },
  ],
};

function userMe(flares: string[], card: unknown = SAVED): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "p1",
      username: "iamlewis",
      flares,
      card,
      currency: { hard: 1240, soft: 6550 },
      progress: { level: 80, prestige: 2, legend: false },
    },
  } as unknown as UserMeResponse;
}

let tab: InventoryCardTab;
let editor: CardEditor;

async function render(
  me: UserMeResponse,
  cosmetics: Cosmetics | null = COSMETICS,
) {
  editor = new CardEditor();
  tab = document.createElement("inventory-card-tab") as InventoryCardTab;
  tab.editor = editor;
  tab.userMe = me;
  tab.cosmetics = cosmetics;
  tab.flag = "/flags/gb.svg";
  tab.flagName = "United Kingdom";
  document.body.appendChild(tab);
  await settle();
}
async function settle() {
  await tab.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await tab.updateComplete;
}
const q = <T extends Element = HTMLElement>(s: string) =>
  tab.querySelector<T>(s);
const qa = (s: string) => [...tab.querySelectorAll<HTMLElement>(s)];
const row = (i: number) => q(`[data-card-slot-row='tracker:${i}']`)!;
async function click(el: Element | null) {
  (el as HTMLElement).click();
  await settle();
}
const pick = (key: string) => q(`[data-card-pick='${key}']`)!;
const tileState = (key: string) =>
  pick(key).querySelector<HTMLElement>("inventory-item-tile")!.dataset
    .itemState;
async function pickTile(key: string) {
  await click(pick(key).querySelector("[data-tile-main]"));
}

beforeEach(() => {
  api.save.mockReset();
  shop.buy.mockReset();
  shop.check.mockReset();
});
afterEach(() => {
  tab?.remove();
  vi.useRealTimers();
});

describe("<inventory-card-tab> owner layout and picker", () => {
  it("has a Background row and three tracker rows, no Taunt or Title slot", async () => {
    await render(userMe(OWNER));
    expect(q("[data-card-slot='background']")).not.toBeNull();
    expect(qa("[data-card-slot-row]")).toHaveLength(3);
    expect(q("[data-card-slot='taunt']")).toBeNull();
    expect(q("[data-card-slot='title']")).toBeNull();
    expect(tab.textContent).not.toContain("my_card.slot_taunt");
    expect(tab.textContent).not.toContain("my_card.slot_title");
  });

  it("rows read left to right in the saved order", async () => {
    await render(userMe(OWNER));
    expect(row(0).textContent).toContain("player_card.tracker_wins");
    expect(row(1).textContent).toContain("player_card.tracker_nukes_launched");
    expect(row(2).textContent).toContain("player_card.tracker_best_elo");
  });

  it("↑ is disabled on row 1 and ↓ on row 3", async () => {
    await render(userMe(OWNER));
    const up = (i: number) =>
      row(i).querySelector<HTMLButtonElement>("[data-card-row-up]")!;
    const down = (i: number) =>
      row(i).querySelector<HTMLButtonElement>("[data-card-row-down]")!;
    expect(up(0).disabled).toBe(true);
    expect(down(0).disabled).toBe(false);
    expect(up(2).disabled).toBe(false);
    expect(down(2).disabled).toBe(true);
  });

  it("↑/↓ reorder the rows", async () => {
    await render(userMe(OWNER));
    await click(row(0).querySelector("[data-card-row-down]"));
    expect(editor.draft.rows.tracker).toEqual([
      "nukes_launched",
      "wins",
      "best_elo",
    ]);
    await click(row(2).querySelector("[data-card-row-up]"));
    expect(editor.draft.rows.tracker).toEqual([
      "nukes_launched",
      "best_elo",
      "wins",
    ]);
  });

  it("dragging a row onto another moves it there", async () => {
    await render(userMe(OWNER));
    row(0).dispatchEvent(new Event("dragstart", { bubbles: true }));
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    row(2).dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    row(2).dispatchEvent(new Event("drop", { bubbles: true }));
    await settle();
    expect(editor.draft.rows.tracker).toEqual([
      "nukes_launched",
      "best_elo",
      "wins",
    ]);
  });

  it("selecting a slot opens its grid below, with filters and a Store tile last", async () => {
    await render(userMe(OWNER));
    expect(q("[data-card-picker]")).toBeNull();
    await click(row(2).querySelector("[data-card-row-open]"));
    const picker = q("[data-card-picker]")!;
    expect(picker.dataset.cardPicker).toBe("tracker:2");
    expect(picker.querySelector("[data-card-filter='owned']")).not.toBeNull();
    const grid = picker.querySelector("[data-card-grid]")!;
    expect(grid.lastElementChild!.hasAttribute("data-card-store-tile")).toBe(
      true,
    );
    // A grid, never a sideways scroller.
    expect(grid.className).toContain("grid");
    expect(grid.className).not.toContain("overflow-x");
  });

  it("tiles in use say which slot they're in", async () => {
    await render(userMe(OWNER));
    await click(row(2).querySelector("[data-card-row-open]"));
    expect(pick("cardTracker:wins").textContent).toContain(
      'inventory_card.in_slot:{"slot":1}',
    );
    expect(pick("cardTracker:nukes_launched").textContent).toContain(
      'inventory_card.in_slot:{"slot":2}',
    );
    expect(pick("cardTracker:games_played").textContent).toContain(
      "inventory.state_owned",
    );
  });

  it("hovering a stat that's in another slot says where both go; picking it swaps", async () => {
    await render(userMe(OWNER));
    await click(row(2).querySelector("[data-card-row-open]"));
    pick("cardTracker:wins").dispatchEvent(
      new Event("mouseenter", { bubbles: true }),
    );
    await settle();
    expect(q("[data-card-swap-hint]")!.textContent).toContain(
      "inventory_card.swap_hint:",
    );
    expect(q("[data-card-swap-hint]")!.textContent).toContain('"to":3');
    expect(q("[data-card-swap-hint]")!.textContent).toContain('"from":1');
    await pickTile("cardTracker:wins");
    expect(editor.draft.rows.tracker).toEqual([
      "best_elo",
      "nukes_launched",
      "wins",
    ]);
  });

  it("picking an owned stat puts it in the open slot, marked Not saved", async () => {
    await render(userMe(OWNER));
    await click(row(2).querySelector("[data-card-row-open]"));
    await pickTile("cardTracker:games_played");
    expect(editor.draft.rows.tracker[2]).toBe("games_played");
    expect(tileState("cardTracker:games_played")).toBe("unsaved");
    expect(row(2).textContent).toContain("inventory_card.was:");
  });

  it("the Saved / With changes switch shows the right card", async () => {
    await render(userMe([...OWNER, "cardBackground:bg_storm"]));
    await click(q("[data-card-slot='background']"));
    await pickTile("cardBackground:bg_storm");
    const shown = () =>
      (
        q("[data-card-preview] player-card") as unknown as {
          view: { background: { name: string } | null };
        }
      ).view.background?.name;
    expect(shown()).toBe("bg_storm");
    await click(q("[data-card-view='saved']"));
    expect(shown()).toBe("bg_pacific");
    await click(q("[data-card-view='changes']"));
    expect(shown()).toBe("bg_storm");
  });

  it("the large preview is animated; tiles are still", async () => {
    await render(userMe(OWNER));
    expect(q("[data-card-preview] player-card")!.hasAttribute("animated")).toBe(
      true,
    );
    await click(q("[data-card-slot='background']"));
    for (const card of qa("[data-card-picker] player-card")) {
      expect(card.hasAttribute("animated")).toBe(false);
    }
  });

  it("the flag line names the in-game flag", async () => {
    await render(userMe(OWNER));
    expect(q("[data-card-flag-note]")!.textContent).toContain(
      'inventory_card.flag_note:{"flag":"United Kingdom"}',
    );
  });

  it("a catalogue that failed to load still renders the tab (no card art)", async () => {
    await render(userMe(OWNER), null);
    expect(q("[data-card-slot='background']")).not.toBeNull();
    expect(q("[data-card-preview] player-card")).not.toBeNull();
  });

  it("an earned item shows how to unlock it and never enters the changes", async () => {
    await render(userMe(OWNER));
    await click(q("[data-card-slot='background']"));
    await click(q("[data-card-filter='all']"));
    await pickTile("cardBackground:bg_redplanet");
    expect(editor.changeCount()).toBe(0);
    expect(q("[data-card-unlock-note]")!.textContent).toContain(
      "Season 1 · free tier 20",
    );
  });
});
