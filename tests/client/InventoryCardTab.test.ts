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
// Signed in as the fixture player (Auth's currentPublicId).
const session = vi.hoisted(() => ({ id: "p1" as string | null }));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  currentPublicId: () => session.id,
}));
const alerts = vi.hoisted(() => ({ show: vi.fn(async () => {}) }));
vi.mock("../../src/client/InGameModal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/InGameModal")>()),
  showInGameAlert: alerts.show,
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

import {
  StorePlacementSchema,
  type UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { CardEditor } from "../../src/client/components/inventory/CardDraft";
import "../../src/client/components/inventory/InventoryCardTab";
import type { InventoryCardTab } from "../../src/client/components/inventory/InventoryCardTab";

const item = { product: null, rarity: "common" };
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
  session.id = "p1";
});
afterEach(() => {
  tab?.remove();
  vi.useRealTimers();
});

describe("<inventory-card-tab> owner layout and picker", () => {
  it("a tab that has left the page never seeds the shared editor again", async () => {
    // The Inventory remakes the tab around its one editor: an update still
    // queued on the old tab when it leaves the page must not seed the
    // editor with that tab's profile, or the two tabs seed it in turn
    // forever.
    const before = userMe(OWNER);
    await render(before);
    const old = tab;
    old.remove();
    const live = document.createElement(
      "inventory-card-tab",
    ) as InventoryCardTab;
    const fresh = userMe(OWNER);
    live.editor = editor;
    live.userMe = fresh;
    live.cosmetics = COSMETICS;
    document.body.appendChild(live);
    await live.updateComplete;
    expect(editor.isSeededWith(fresh)).toBe(true);
    // The old tab's queued update runs, off the page.
    old.requestUpdate();
    (old as unknown as { performUpdate(): void }).performUpdate();
    const seededAfter = editor.isSeededWith(fresh);
    // Cut any loop the update started before asserting, so a failure
    // fails rather than hangs.
    old.editor = null as never;
    old.requestUpdate();
    (old as unknown as { performUpdate(): void }).performUpdate();
    live.remove();
    expect(seededAfter).toBe(true);
  });

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

  it("a stat the server has no value for reads — on the tile and on the card", async () => {
    await render(userMe(OWNER));
    await click(row(2).querySelector("[data-card-row-open]"));
    expect(
      pick("cardTracker:games_played").querySelector("[data-tile-main]")!
        .textContent,
    ).toContain("—");
    await pickTile("cardTracker:games_played");
    const card = q("[data-card-preview] player-card")!;
    await (card as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;
    const values = [...card.querySelectorAll("[data-card-tracker]")].map(
      (t) => t.textContent ?? "",
    );
    // Never 0 (the stat has no value), but "—".
    expect(values.some((v) => /\b0\b/.test(v))).toBe(false);
    expect(values.some((v) => v.includes("—"))).toBe(true);
  });

  it("a tracker whose name isn't its stat is never offered (rows save names as stats)", async () => {
    const odd = structuredClone(COSMETICS) as Cosmetics;
    (odd.cardTrackers as Record<string, object>).renamed = {
      ...item,
      name: "renamed",
      stat: "conquests",
      priceSoft: 400,
    };
    await render(userMe([...OWNER, "cardTracker:renamed"]), odd);
    await click(row(2).querySelector("[data-card-row-open]"));
    await click(q("[data-card-filter='all']"));
    expect(q("[data-card-pick='cardTracker:renamed']")).toBeNull();
    expect(q("[data-card-pick='cardTracker:conquests']")).not.toBeNull();
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

describe("<inventory-card-tab> save bar", () => {
  async function changeTracker3() {
    await click(row(2).querySelector("[data-card-row-open]"));
    await pickTile("cardTracker:games_played");
  }
  const bar = () => q("[data-card-save-bar]");
  const saveButton = () => q<HTMLButtonElement>("[data-card-save]")!;

  it("there's no bar without changes", async () => {
    await render(userMe(OWNER));
    expect(bar()).toBeNull();
  });

  it("lists the changes", async () => {
    await render(userMe(OWNER));
    await changeTracker3();
    expect(q("[data-card-change-count]")!.textContent).toContain(
      'inventory_card.changes_not_saved:{"count":1}',
    );
    const summary = q("[data-card-changes-summary]")!.textContent!;
    expect(summary).toContain("inventory_card.change_line:");
    expect(summary).toContain(
      '"slot":"inventory_card.slot_tracker:{\\"slot\\":3}"',
    );
    expect(summary).toContain('"from":"player_card.tracker_best_elo"');
    expect(summary).toContain('"to":"player_card.tracker_games_played"');
  });

  it("Discard restores the saved card", async () => {
    await render(userMe(OWNER));
    await changeTracker3();
    await click(q("[data-card-discard]"));
    expect(editor.draft.rows.tracker).toEqual([
      "wins",
      "nukes_launched",
      "best_elo",
    ]);
    expect(bar()).toBeNull();
  });

  it("Save card → Saving… → Saved for 2 seconds → gone", async () => {
    let finish!: (v: unknown) => void;
    api.save.mockReturnValue(new Promise((r) => (finish = r)));
    await render(userMe(OWNER));
    await changeTracker3();
    expect(saveButton().textContent).toContain("inventory_card.save_card");
    await click(saveButton());
    expect(saveButton().textContent).toContain("inventory_card.saving");
    expect(saveButton().disabled).toBe(true);
    vi.useFakeTimers();
    finish({ ok: true, loadout: {} });
    await vi.waitFor(() =>
      expect(saveButton().textContent).toContain("inventory_card.saved"),
    );
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
    await settle();
    expect(bar()).toBeNull();
  });

  it("sends a saved taunt and title back unchanged", async () => {
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    await render(userMe(OWNER));
    await changeTracker3();
    await click(saveButton());
    expect(api.save).toHaveBeenCalledWith(
      {
        background: "bg_pacific",
        title: "warmonger",
        taunt: "salute",
        trackers: ["wins", "nukes_launched", "games_played"],
      },
      expect.any(Function),
    );
  });

  it("a failed save says so with Retry and a toast, and keeps the changes", async () => {
    api.save.mockResolvedValue({ ok: false, error: "failed" });
    await render(userMe(OWNER));
    await changeTracker3();
    await click(saveButton());
    expect(saveButton().textContent).toContain("inventory_card.save_retry");
    const toast = q("[data-card-save-toast]")!;
    expect(toast.getAttribute("role")).toBe("alert");
    expect(toast.textContent).toContain("inventory_card.save_failed_title");
    expect(editor.changeCount()).toBe(1);
    api.save.mockResolvedValue({ ok: true, loadout: {} });
    await click(q("[data-card-toast-retry]"));
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(q("[data-card-save-toast]")).toBeNull();
    expect(saveButton().textContent).toContain("inventory_card.saved");
  });

  it("the toast's Retry is off while the editor can't save, like Save's", async () => {
    api.save.mockResolvedValue({ ok: false, error: "failed" });
    await render(userMe(OWNER));
    await changeTracker3();
    await click(saveButton());
    // A token refresh failed: the account can't be read for now.
    session.id = null;
    tab.requestUpdate();
    await settle();
    expect(saveButton().disabled).toBe(true);
    const retry = q<HTMLButtonElement>("[data-card-toast-retry]")!;
    expect(retry.disabled).toBe(true);
    await click(retry);
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});

describe("<inventory-card-tab> without the card", () => {
  const NO_CARD = ["cardBackground:bg_pacific"];
  const getCard = () => q("[data-card-get-card]")!;
  const buyButton = () =>
    getCard().querySelector("purchase-button") as unknown as {
      priceHard: number | null;
      priceSoft: number | null;
      listPriceHard: number | null;
      promotion: unknown;
      onPurchaseHard: () => Promise<unknown>;
      onPurchaseSoft: () => Promise<unknown>;
    };

  it("shows the Get the player card screen, not the editor", async () => {
    await render(userMe(NO_CARD, null));
    expect(getCard()).not.toBeNull();
    expect(q("[data-card-slot='background']")).toBeNull();
    expect(q("[data-card-save-bar]")).toBeNull();
    expect(getCard().textContent).toContain("inventory_card.get_title");
  });

  it("the sample card uses the player's own name and badge", async () => {
    await render(userMe(NO_CARD, null));
    const view = (
      getCard().querySelector("player-card") as unknown as {
        view: { username: string; badge: { level: number } | null };
      }
    ).view;
    expect(view.username).toBe("iamlewis");
    expect(view.badge?.level).toBe(80);
  });

  it("says what's included: a background and up to 3 trackers, no taunt", async () => {
    await render(userMe(NO_CARD, null));
    const included = qa("[data-card-included]").map(
      (li) => li.dataset.cardIncluded,
    );
    expect(included).toEqual(["background", "trackers"]);
  });

  it("prices come from the catalogue's card item", async () => {
    await render(userMe(NO_CARD, null));
    expect(buyButton().priceHard).toBe(300);
    expect(buyButton().priceSoft).toBe(30000);
    tab.remove();
    const other = structuredClone(COSMETICS) as Cosmetics;
    (
      other.playerCards as Record<string, { priceHard: number }>
    ).standard.priceHard = 450;
    await render(userMe(NO_CARD, null), other);
    expect(buyButton().priceHard).toBe(450);
  });

  it("a running sale shows the list price to strike through", async () => {
    const onSale = structuredClone(COSMETICS) as Cosmetics;
    Object.assign((onSale.playerCards as Record<string, object>).standard, {
      priceHard: 240,
      listPriceHard: 300,
      promotion: {
        name: "Launch sale",
        percentOff: 20,
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    await render(userMe(NO_CARD, null), onSale);
    expect(buyButton().priceHard).toBe(240);
    expect(buyButton().listPriceHard).toBe(300);
    expect(buyButton().promotion).not.toBeNull();
  });

  it("buying goes through the currency purchase flow, in place", async () => {
    shop.buy.mockResolvedValue({ kind: "owned", fresh: false });
    await render(userMe(NO_CARD, null));
    await buyButton().onPurchaseHard();
    expect(shop.buy.mock.calls[0][0]).toMatchObject({
      key: "playerCard:standard",
      type: "playerCard",
    });
    expect(shop.buy.mock.calls[0][1]).toBe("hard");
    // Attributed to the Inventory's Player card tab, in the shape the
    // infra API takes.
    expect(shop.buy.mock.calls[0][2]).toEqual({
      kind: "inventory",
      subTab: "card",
    });
    expect(
      StorePlacementSchema.safeParse(shop.buy.mock.calls[0][2]).success,
    ).toBe(true);
  });

  it("a buy whose profile read can't reach the server says so", async () => {
    shop.buy.mockResolvedValue({ kind: "unreachable" });
    alerts.show.mockClear();
    await render(userMe(NO_CARD, null));
    await buyButton().onPurchaseHard();
    expect(alerts.show).toHaveBeenCalledWith(
      "inventory_card.server_unreachable",
    );
  });

  it("a buy is sent only as the account signed in now", async () => {
    shop.buy.mockResolvedValue({ kind: "owned", fresh: false });
    await render(userMe(NO_CARD, null));
    await buyButton().onPurchaseHard();
    expect(shop.buy.mock.calls[0][4]).toBe("p1");
  });

  it("a buy is sent as the account that opened the confirm, not one signed in since", async () => {
    shop.check.mockResolvedValue({ ok: true, balance: 5000 });
    shop.buy.mockResolvedValue({ kind: "signed_out" });
    await render(userMe(NO_CARD, null));
    const button = buyButton() as unknown as {
      preflight: (m: "hard" | "soft") => Promise<unknown>;
      onPurchaseHard: () => Promise<unknown>;
    };
    await button.preflight("hard");
    // Another tab signs in as someone else while the confirm is open.
    session.id = "p2";
    await button.onPurchaseHard();
    expect(shop.buy.mock.calls[0][4]).toBe("p1");
  });

  it("a balance read as another account than the session's is read again before the confirm", async () => {
    shop.check
      .mockResolvedValueOnce({ ok: true, balance: 5000, publicId: "p1" })
      .mockResolvedValueOnce({ ok: true, balance: 100, publicId: "p2" });
    shop.buy.mockResolvedValue({ kind: "owned", fresh: false });
    await render(userMe(NO_CARD, null));
    const button = buyButton() as unknown as {
      preflight: (m: "hard" | "soft") => Promise<unknown>;
      onPurchaseHard: () => Promise<unknown>;
    };
    // A's profile answers after a switch to B: its balance isn't B's.
    session.id = "p2";
    expect(await button.preflight("hard")).toEqual({
      ok: true,
      balance: 100,
      publicId: "p2",
    });
    await button.onPurchaseHard();
    expect(shop.buy.mock.calls[0][4]).toBe("p2");
  });

  it("a balance that stays another account's opens no confirm, and nothing is bought", async () => {
    alerts.show.mockClear();
    shop.check.mockResolvedValue({ ok: true, balance: 5000, publicId: "p1" });
    await render(userMe(NO_CARD, null));
    const button = buyButton() as unknown as {
      preflight: (m: "hard" | "soft") => Promise<{ ok: boolean }>;
    };
    session.id = "p2";
    expect((await button.preflight("hard")).ok).toBe(false);
    expect(alerts.show).toHaveBeenCalledWith(
      "inventory_card.server_unreachable",
    );
  });

  it("with the session's account unknown, the buy goes as the account whose balance was shown", async () => {
    shop.check.mockResolvedValue({ ok: true, balance: 5000, publicId: "p1" });
    shop.buy.mockResolvedValue({ kind: "owned", fresh: false });
    await render(userMe(NO_CARD, null));
    const button = buyButton() as unknown as {
      preflight: (m: "hard" | "soft") => Promise<unknown>;
      onPurchaseHard: () => Promise<unknown>;
    };
    session.id = null;
    await button.preflight("hard");
    await button.onPurchaseHard();
    expect(shop.buy.mock.calls[0][4]).toBe("p1");
  });

  it("sends the price the confirm box showed, even if the catalogue changes while it is open", async () => {
    shop.check.mockResolvedValue({ ok: true, balance: 5000 });
    shop.buy.mockResolvedValue({ kind: "owned", fresh: false });
    await render(userMe(NO_CARD, null));
    const button = buyButton() as unknown as HTMLElement & {
      requestCurrencyPurchase(method: "hard"): void;
      updateComplete: Promise<unknown>;
    };
    button.requestCurrencyPurchase("hard");
    await settle();
    await button.updateComplete;
    // A new catalogue lands while the box is open (a cohort reload).
    const raised = structuredClone(COSMETICS) as Cosmetics;
    (
      raised.playerCards as Record<string, { priceHard: number }>
    ).standard.priceHard = 450;
    tab.cosmetics = raised;
    await settle();
    button
      .querySelector("confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));
    await settle();
    // purchaseCosmeticInPlace's shownAmount: sent as expectedAmount, so
    // the server answers price_changed rather than charging 450.
    expect(shop.buy).toHaveBeenCalledTimes(1);
    expect(shop.buy.mock.calls[0][5]).toBe(300);
  });

  it("See it in the Store asks for the card in the Store", async () => {
    await render(userMe(NO_CARD, null));
    const seen: unknown[] = [];
    tab.addEventListener("open-store", (e) =>
      seen.push((e as CustomEvent).detail),
    );
    await click(q("[data-card-see-store]"));
    expect(seen).toEqual([{ item: "playerCard:standard" }]);
  });
});

describe("<inventory-card-tab> unowned items in the changes", () => {
  const buyGroup = (flare: string) => q(`[data-card-buy='${flare}']`);
  const buttonIn = (flare: string) =>
    buyGroup(flare)!.querySelector("purchase-button") as unknown as {
      priceHard: number | null;
      priceSoft: number | null;
      onPurchaseHard: () => Promise<unknown>;
    };
  const saveButton = () => q<HTMLButtonElement>("[data-card-save]")!;
  async function pickStorm() {
    await click(q("[data-card-slot='background']"));
    await click(q("[data-card-filter='all']"));
    await pickTile("cardBackground:bg_storm");
  }

  it("picking an unowned item puts it on the With changes card", async () => {
    await render(userMe(OWNER));
    await pickStorm();
    expect(editor.draft.background).toBe("bg_storm");
    const shown = (
      q("[data-card-preview] player-card") as unknown as {
        view: { background: { name: string } | null };
      }
    ).view.background?.name;
    expect(shown).toBe("bg_storm");
  });

  it("a picked unowned item stays under Not owned, never under Owned", async () => {
    await render(userMe(OWNER));
    await pickStorm();
    if (q("[data-card-filter='notOwned']") === null) {
      await click(q("[data-card-slot='background']"));
    }
    await click(q("[data-card-filter='notOwned']"));
    expect(q("[data-card-pick='cardBackground:bg_storm']")).not.toBeNull();
    expect(tileState("cardBackground:bg_storm")).toBe("unsaved");
    await click(q("[data-card-filter='owned']"));
    expect(q("[data-card-pick='cardBackground:bg_storm']")).toBeNull();
    // The saved one, owned, is still there.
    expect(q("[data-card-pick='cardBackground:bg_pacific']")).not.toBeNull();
  });

  it("the bar offers Buy <item> in both currencies, and Save is disabled", async () => {
    await render(userMe(OWNER));
    await pickStorm();
    expect(buyGroup("cardBackground:bg_storm")!.textContent).toContain(
      "inventory_card.buy_item:",
    );
    expect(buttonIn("cardBackground:bg_storm").priceHard).toBe(240);
    expect(buttonIn("cardBackground:bg_storm").priceSoft).toBe(2400);
    expect(saveButton().disabled).toBe(true);
  });

  it("once bought, the bar is back to Save card with the change in place", async () => {
    shop.buy.mockResolvedValue({ kind: "owned", fresh: false });
    await render(userMe(OWNER));
    await pickStorm();
    await buttonIn("cardBackground:bg_storm").onPurchaseHard();
    expect(shop.buy.mock.calls[0][0]).toMatchObject({
      key: "cardBackground:bg_storm",
    });
    expect(shop.buy.mock.calls[0][2]).toEqual({
      kind: "inventory",
      subTab: "card",
    });
    // The purchase broadcasts a fresh profile, which now owns it.
    tab.userMe = userMe([...OWNER, "cardBackground:bg_storm"]);
    await settle();
    expect(buyGroup("cardBackground:bg_storm")).toBeNull();
    expect(editor.draft.background).toBe("bg_storm");
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().textContent).toContain("inventory_card.save_card");
  });

  it("Discard drops the unowned item", async () => {
    await render(userMe(OWNER));
    await pickStorm();
    await click(q("[data-card-discard]"));
    expect(editor.draft.background).toBe("bg_pacific");
    expect(buyGroup("cardBackground:bg_storm")).toBeNull();
  });

  it("two unowned items: two Buy buttons, Save off until each is bought", async () => {
    await render(userMe(OWNER));
    await pickStorm();
    await click(row(2).querySelector("[data-card-row-open]"));
    await click(q("[data-card-filter='all']"));
    await pickTile("cardTracker:conquests");
    expect(qa("[data-card-buy]")).toHaveLength(2);
    expect(saveButton().disabled).toBe(true);
    tab.userMe = userMe([...OWNER, "cardBackground:bg_storm"]);
    await settle();
    expect(qa("[data-card-buy]")).toHaveLength(1);
    expect(saveButton().disabled).toBe(true);
    tab.userMe = userMe([
      ...OWNER,
      "cardBackground:bg_storm",
      "cardTracker:conquests",
    ]);
    await settle();
    expect(qa("[data-card-buy]")).toHaveLength(0);
    expect(saveButton().disabled).toBe(false);
  });
});

describe("<inventory-card-tab> large preview", () => {
  it("a tile's preview opens the large animated preview of that item on the card", async () => {
    await render(userMe(OWNER));
    await click(q("[data-card-slot='background']"));
    await click(q("[data-card-filter='all']"));
    await click(
      pick("cardBackground:bg_storm").querySelector("[data-tile-preview]"),
    );
    // Previewing never picks.
    expect(editor.changeCount()).toBe(0);
    const card = q("card-item-preview player-card") as unknown as {
      animated: boolean;
      view: { username: string; background: { name: string } | null };
    };
    expect(card.animated).toBe(true);
    expect(card.view.background?.name).toBe("bg_storm");
    expect(card.view.username).toBe("iamlewis");
    await click(q("[data-card-preview-close]"));
    expect(q("card-item-preview")).toBeNull();
  });

  it("tracker tiles preview the stat on the card", async () => {
    await render(userMe(OWNER));
    await click(row(2).querySelector("[data-card-row-open]"));
    await click(
      pick("cardTracker:games_played").querySelector("[data-tile-preview]"),
    );
    const card = q("card-item-preview player-card") as unknown as {
      view: { trackers: { stat: string }[] };
    };
    expect(card.view.trackers.map((t) => t.stat)).toEqual([
      "wins",
      "nukes_launched",
      "games_played",
    ]);
  });
});

describe("<inventory-card-tab> on a phone", () => {
  it("every slot is a row; ↑/↓ are 44px touch targets", async () => {
    await render(userMe(OWNER));
    expect(q("[data-card-slot='background']")!.className).toContain("min-h-14");
    for (const button of qa("[data-card-row-up], [data-card-row-down]")) {
      expect(button.className).toContain("h-11");
      expect(button.className).toContain("w-11");
    }
  });

  it("the picker is a bottom sheet with a real Done button; the preview stays above", async () => {
    await render(userMe(OWNER));
    await click(row(2).querySelector("[data-card-row-open]"));
    const sheet = q("[data-card-sheet]")!;
    expect(sheet.className).toContain("max-md:fixed");
    expect(sheet.className).toContain("max-md:bottom-0");
    expect(sheet.querySelector("[data-card-picker]")!.className).toContain(
      "max-md:max-h-[45vh]",
    );
    // The preview isn't inside the sheet.
    expect(sheet.querySelector("[data-card-preview]")).toBeNull();
    const done = sheet.querySelector<HTMLButtonElement>(
      "[data-card-picker-done]",
    )!;
    expect(done.className).toContain("min-h-11");
    await pickTile("cardTracker:games_played");
    await click(done);
    // Done closes the sheet; it doesn't save.
    expect(q("[data-card-picker]")).toBeNull();
    expect(api.save).not.toHaveBeenCalled();
    expect(editor.changeCount()).toBe(1);
  });

  it("the Save bar sits in the sheet's place at the bottom", async () => {
    await render(userMe(OWNER));
    await click(row(2).querySelector("[data-card-row-open]"));
    await pickTile("cardTracker:games_played");
    const sheet = q("[data-card-sheet]")!;
    expect(sheet.lastElementChild!.hasAttribute("data-card-save-bar")).toBe(
      true,
    );
  });
});
