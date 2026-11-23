import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getUserMe } from "../../src/client/Api";
import { userAuth } from "../../src/client/Auth";
import { saveCardLoadout } from "../../src/client/CardLoadoutApi";
import {
  clearPendingPurchase,
  peekPendingPurchase,
} from "../../src/client/components/inventory/PendingEquip";
import {
  broadcastFreshUserMe,
  checkInPlacePurchase,
  fetchCosmetics,
} from "../../src/client/Cosmetics";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
}));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  userAuth: vi.fn(),
}));
vi.mock("../../src/client/CardLoadoutApi", () => ({
  saveCardLoadout: vi.fn(),
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../src/client/Cosmetics")>();
  return {
    ...real,
    fetchCosmetics: vi.fn(),
    invalidateCosmetics: vi.fn(),
    checkInPlacePurchase: vi.fn(real.checkInPlacePurchase),
  };
});

const item = { product: null, rarity: "common", affiliateCode: null };
function catalog(): Cosmetics {
  return {
    patterns: {},
    flags: {},
    playerCards: {
      standard: { ...item, name: "standard", priceHard: 300, priceSoft: 30000 },
    },
    cardTrackers: Object.fromEntries(
      ["wins", "games_played", "nukes_launched", "best_elo"].map((s) => [
        s,
        { ...item, name: s, stat: s, priceSoft: 400 },
      ]),
    ),
    cardBackgrounds: {
      bg_pacific: { ...item, name: "bg_pacific", url: "/bg/pacific.webp" },
      bg_storm: {
        ...item,
        name: "bg_storm",
        url: "/bg/storm.webp",
        priceSoft: 2400,
      },
    },
    cardTitles: {},
    taunts: {},
  } as unknown as Cosmetics;
}

const OWNER = [
  "playerCard:standard",
  "cardBackground:bg_pacific",
  "cardTracker:wins",
  "cardTracker:games_played",
  "cardTracker:nukes_launched",
  "cardTracker:best_elo",
];
function owner(flares: string[] = OWNER): UserMeResponse {
  return {
    user: {},
    player: {
      publicId: "guard-test-player",
      username: "iamlewis",
      flares,
      currency: { soft: 5000, hard: 5000 },
      card: {
        background: "bg_pacific",
        trackers: [
          { stat: "wins", value: 312 },
          { stat: "nukes_launched", value: 4880 },
          { stat: "best_elo", value: 1612 },
        ],
      },
    },
  } as unknown as UserMeResponse;
}

type CardEditorLike = {
  isSeededWith(userMe: UserMeResponse): boolean;
  canSave(): boolean;
};

async function settle(modal: InventoryModal) {
  for (let i = 0; i < 5; i++) {
    await modal.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("Inventory: unsaved card changes guard", () => {
  let modal: InventoryModal;
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;
  beforeAll(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog());
    vi.mocked(userAuth).mockResolvedValue({
      jwt: "token",
      claims: {},
    } as Awaited<ReturnType<typeof userAuth>>);
    vi.mocked(getUserMe).mockResolvedValue(owner());
    vi.mocked(saveCardLoadout).mockReset();
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
  });
  afterEach(() => {
    modal.remove();
    document.body.innerHTML = "";
    clearPendingPurchase();
    window.location.hash = "";
    vi.clearAllMocks();
  });

  const q = <T extends HTMLElement = HTMLElement>(s: string) =>
    modal.querySelector<T>(s);
  async function click(selector: string) {
    q(selector)!.click();
    await settle(modal);
  }
  /** Opens the card tab and changes tracker 3 to Games played. */
  async function openWithChange() {
    modal.open({ tab: "card" });
    await settle(modal);
    await click("[data-card-slot-row='tracker:2'] [data-card-row-open]");
    await click("[data-card-pick='cardTracker:games_played'] [data-tile-main]");
  }
  const onCardTab = () =>
    q("[data-inventory-top-tab='card']")!.getAttribute("aria-selected") ===
    "true";
  const back = () =>
    modal.querySelector<HTMLButtonElement>("[slot='header'] button")!;

  it("no changes: switching to In game goes straight there", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    await click("[data-inventory-top-tab='ingame']");
    expect(q("[data-card-guard]")).toBeNull();
    expect(onCardTab()).toBe(false);
  });

  it("switching to In game with a change asks first; Keep editing stays", async () => {
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    const guard = q("[data-card-guard]")!;
    // "You have 1 unsaved change to your card", then the change itself.
    expect(guard.dataset.count).toBe("1");
    expect(guard.querySelectorAll("[data-card-guard-line]")).toHaveLength(1);
    await click("[data-card-guard-keep]");
    expect(q("[data-card-guard]")).toBeNull();
    expect(onCardTab()).toBe(true);
    expect(q("[data-card-save-bar]")).not.toBeNull();
  });

  it("Discard drops the changes and goes", async () => {
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-card-guard-discard]");
    expect(onCardTab()).toBe(false);
    await click("[data-inventory-top-tab='card']");
    expect(q("[data-card-save-bar]")).toBeNull();
  });

  it("Save stores the changes, then goes", async () => {
    vi.mocked(saveCardLoadout).mockResolvedValue({
      ok: true,
      loadout: {} as never,
    });
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-card-guard-save]");
    expect(saveCardLoadout).toHaveBeenCalledWith(
      expect.objectContaining({
        trackers: ["wins", "nukes_launched", "games_played"],
      }),
      expect.any(Function),
    );
    expect(onCardTab()).toBe(false);
  });

  /** Clicks the bar's Save card with the PUT held until `finish`. */
  async function saveHeld() {
    let finish!: (v: Awaited<ReturnType<typeof saveCardLoadout>>) => void;
    vi.mocked(saveCardLoadout).mockReturnValueOnce(
      new Promise((r) => (finish = r)),
    );
    await click("[data-card-save]");
    return (v: Awaited<ReturnType<typeof saveCardLoadout>>) => finish(v);
  }
  const guardButton = (name: string) =>
    q<HTMLButtonElement>(`[data-card-guard-${name}]`)!;

  it("leaving while the bar's save is in flight: Saving, no Discard; once it lands, goes", async () => {
    await openWithChange();
    const finish = await saveHeld();
    await click("[data-inventory-top-tab='ingame']");
    // Discarding now would set the draft to the card being replaced.
    expect(q("[data-card-guard]")).not.toBeNull();
    expect(guardButton("discard").disabled).toBe(true);
    expect(guardButton("save").disabled).toBe(true);
    expect(guardButton("save").textContent).toContain("inventory_card.saving");
    expect(onCardTab()).toBe(true);
    finish({ ok: true, loadout: {} as never });
    await settle(modal);
    expect(q("[data-card-guard]")).toBeNull();
    expect(onCardTab()).toBe(false);
    // Back on the card: nothing that would undo the save.
    await click("[data-inventory-top-tab='card']");
    expect(q("[data-card-change-count]")).toBeNull();
    expect(saveCardLoadout).toHaveBeenCalledTimes(1);
  });

  it("an edit made during that save: once it lands, the guard asks about that edit only", async () => {
    await openWithChange();
    const finish = await saveHeld();
    await click("[data-card-slot-row='tracker:0'] [data-card-row-open]");
    await click("[data-card-pick='cardTracker:best_elo'] [data-tile-main]");
    await click("[data-inventory-top-tab='ingame']");
    finish({ ok: true, loadout: {} as never });
    await settle(modal);
    const guard = q("[data-card-guard]")!;
    // Tracker 1 (wins → best_elo); tracker 3 (games_played) is saved.
    expect(guard.dataset.count).toBe("1");
    expect(guardButton("discard").disabled).toBe(false);
    expect(guardButton("save").disabled).toBe(false);
    await click("[data-card-guard-discard]");
    expect(onCardTab()).toBe(false);
    await click("[data-inventory-top-tab='card']");
    expect(q("[data-card-change-count]")).toBeNull();
  });

  it("that save failing: the guard offers Save again, and Discard", async () => {
    await openWithChange();
    const finish = await saveHeld();
    await click("[data-inventory-top-tab='ingame']");
    finish({ ok: false, error: "failed" });
    await settle(modal);
    expect(q("[data-card-guard]")!.dataset.count).toBe("1");
    expect(guardButton("save").disabled).toBe(false);
    expect(guardButton("discard").disabled).toBe(false);
    expect(onCardTab()).toBe(true);
  });

  it("a guard Save landing after a newer guard opened leaves that guard to be answered", async () => {
    let finish!: (v: Awaited<ReturnType<typeof saveCardLoadout>>) => void;
    vi.mocked(saveCardLoadout).mockReturnValueOnce(
      new Promise((r) => (finish = r)),
    );
    await openWithChange();
    // Guard A: Save, with the PUT held.
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-card-guard-save]");
    // Browser Back closes the Inventory with no guard; reopen and edit.
    modal.close();
    await settle(modal);
    modal.open({ tab: "card" });
    await settle(modal);
    await click("[data-card-slot-row='tracker:0'] [data-card-row-open]");
    await click("[data-card-pick='cardTracker:games_played'] [data-tile-main]");
    // Guard B, Saving while A's save is in flight.
    await click("[data-inventory-top-tab='ingame']");
    expect(q("[data-card-guard]")).not.toBeNull();
    finish({ ok: true, loadout: {} as never });
    await settle(modal);
    // B is still there, now with a choice, and answering it goes.
    expect(q("[data-card-guard]")).not.toBeNull();
    expect(guardButton("discard").disabled).toBe(false);
    await click("[data-card-guard-discard]");
    expect(q("[data-card-guard]")).toBeNull();
    expect(onCardTab()).toBe(false);
  });

  /** The card tab's shortfall box (no game to leave), as a Buy opens it. */
  async function plutoniumShort() {
    const dialog = document.createElement(
      "insufficient-currency-dialog",
    ) as HTMLElement & { info: unknown; updateComplete: Promise<unknown> };
    dialog.info = {
      currency: "Plutonium",
      shortfall: 220,
      item: "Storm",
      canTopUp: true,
      leavesGame: false,
      itemKey: "cardBackground:bg_storm",
      player: "guard-test-player",
    };
    q("inventory-card-tab")!.appendChild(dialog);
    await dialog.updateComplete;
    return dialog.querySelector("confirm-dialog")!;
  }

  it("Get Plutonium with changes asks first; Keep editing stays", async () => {
    await openWithChange();
    (await plutoniumShort()).dispatchEvent(new CustomEvent("confirm"));
    await settle(modal);
    expect(q("[data-card-guard]")).not.toBeNull();
    expect(window.location.hash).not.toContain("tab=packs");
    await click("[data-card-guard-keep]");
    expect(modal.isOpen()).toBe(true);
    expect(window.location.hash).not.toContain("tab=packs");
    expect(q("[data-card-save-bar]")).not.toBeNull();
  });

  it("Get Plutonium, then Discard: goes to the packs, the item remembered", async () => {
    await openWithChange();
    (await plutoniumShort()).dispatchEvent(new CustomEvent("confirm"));
    await settle(modal);
    await click("[data-card-guard-discard]");
    expect(modal.isOpen()).toBe(false);
    expect(window.location.hash).toBe("#modal=store&tab=packs");
    expect(peekPendingPurchase("guard-test-player")).toBe(
      "cardBackground:bg_storm",
    );
  });

  it("Get Plutonium from a page path changes only the hash, as the Store links do", async () => {
    history.replaceState(null, "", "/store");
    try {
      modal.open({ tab: "card" });
      await settle(modal);
      (await plutoniumShort()).dispatchEvent(new CustomEvent("confirm"));
      await settle(modal);
      expect(window.location.pathname).toBe("/store");
      expect(window.location.hash).toBe("#modal=store&tab=packs");
      expect(peekPendingPurchase("guard-test-player")).toBe(
        "cardBackground:bg_storm",
      );
    } finally {
      history.replaceState(null, "", "/");
    }
  });

  it("after session-reauth, an edit on the old profile can't be saved before the new one arrives", async () => {
    vi.mocked(saveCardLoadout).mockResolvedValue({
      ok: true,
      loadout: {} as never,
    });
    modal.open({ tab: "card" });
    await settle(modal);
    document.dispatchEvent(new CustomEvent("session-reauth"));
    await settle(modal);
    await click("[data-card-slot-row='tracker:2'] [data-card-row-open]");
    await click("[data-card-pick='cardTracker:games_played'] [data-tile-main]");
    q<HTMLButtonElement>("[data-card-save]")?.click();
    await settle(modal);
    expect(saveCardLoadout).not.toHaveBeenCalled();
  });

  it("a /users/@me started before session-reauth never seeds the card editor", async () => {
    let answer!: (v: UserMeResponse) => void;
    vi.mocked(getUserMe).mockReturnValueOnce(new Promise((r) => (answer = r)));
    modal.open({ tab: "card" });
    await settle(modal);
    document.dispatchEvent(new CustomEvent("session-reauth"));
    // The old account's request lands after the switch, as a new object.
    const late = owner();
    answer(late);
    await settle(modal);
    const editor = (modal as unknown as { cardEditor: CardEditorLike })
      .cardEditor;
    expect(editor.isSeededWith(late)).toBe(false);
    expect(editor.canSave()).toBe(false);
    // The new session's profile (here the same account again) is taken.
    const fresh = owner();
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    await settle(modal);
    expect(editor.isSeededWith(fresh)).toBe(true);
    await click("[data-card-slot-row='tracker:2'] [data-card-row-open]");
    await click("[data-card-pick='cardTracker:games_played'] [data-tile-main]");
    expect(editor.canSave()).toBe(true);
  });

  it("a purchase's profile refresh from before session-reauth never seeds the card editor", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    // A purchase under A refreshes the profile; the account switches
    // before it lands.
    let answer!: (v: UserMeResponse) => void;
    vi.mocked(getUserMe).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const refreshing = broadcastFreshUserMe();
    document.dispatchEvent(new CustomEvent("session-reauth"));
    const late = owner();
    answer(late);
    await refreshing;
    await settle(modal);
    const editor = (modal as unknown as { cardEditor: CardEditorLike })
      .cardEditor;
    expect(editor.isSeededWith(late)).toBe(false);
    expect(editor.canSave()).toBe(false);
  });

  for (const event of ["session-reauth", "session-cleared"]) {
    it(`${event} with the card tab open drops the unsaved changes`, async () => {
      await openWithChange();
      expect(q("[data-card-change-count]")).not.toBeNull();
      document.dispatchEvent(new CustomEvent(event));
      await settle(modal);
      expect(q("[data-card-change-count]")).toBeNull();
      expect(saveCardLoadout).not.toHaveBeenCalled();
    });
  }

  it("a Save that fails stays, with the changes", async () => {
    vi.mocked(saveCardLoadout).mockResolvedValue({
      ok: false,
      error: "failed",
    });
    await openWithChange();
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-card-guard-save]");
    expect(onCardTab()).toBe(true);
    expect(q("[data-card-save-toast]")).not.toBeNull();
  });

  it("Back asks first; Discard closes the Inventory", async () => {
    await openWithChange();
    back().click();
    await settle(modal);
    expect(q("[data-card-guard]")).not.toBeNull();
    expect(modal.isOpen()).toBe(true);
    await click("[data-card-guard-discard]");
    expect(modal.isOpen()).toBe(false);
  });

  it("a close the guard didn't see (another modal's link, browser Back) drops the changes", async () => {
    await openWithChange();
    // The router closing it directly, with no guard.
    modal.close();
    await settle(modal);
    // Reopened on In game: closing again doesn't ask about stale changes...
    modal.open({ tab: "skins" });
    await settle(modal);
    back().click();
    await settle(modal);
    expect(q("[data-card-guard]")).toBeNull();
    expect(modal.isOpen()).toBe(false);
    // ...and they don't come back on the card tab.
    modal.open({ tab: "card" });
    await settle(modal);
    expect(q("[data-card-save-bar]")).toBeNull();
    expect(saveCardLoadout).not.toHaveBeenCalled();
  });

  it("Escape asks first; Escape again keeps editing", async () => {
    await openWithChange();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle(modal);
    expect(q("[data-card-guard]")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle(modal);
    expect(q("[data-card-guard]")).toBeNull();
    expect(modal.isOpen()).toBe(true);
  });
});

describe("Inventory: Player card tab, signed out", () => {
  let modal: InventoryModal;
  beforeEach(() => {
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog());
    vi.mocked(userAuth).mockResolvedValue(false);
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
  });
  afterEach(() => {
    modal.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the same sign-in prompt as In game, and no card", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    expect(modal.querySelector("[data-inventory-sign-in]")).not.toBeNull();
    expect(modal.querySelector("inventory-card-tab")).toBeNull();
    expect(modal.querySelector("player-card")).toBeNull();
  });
});

describe("Inventory: buying card items in place", () => {
  let modal: InventoryModal;
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog());
    vi.mocked(userAuth).mockResolvedValue({
      jwt: "token",
      claims: {},
    } as Awaited<ReturnType<typeof userAuth>>);
    vi.mocked(getUserMe).mockResolvedValue(owner());
    modal = document.createElement("inventory-modal") as InventoryModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
  });
  afterEach(() => {
    modal.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });
  const q = <T extends HTMLElement = HTMLElement>(s: string) =>
    modal.querySelector<T>(s);
  async function click(selector: string) {
    q(selector)!.click();
    await settle(modal);
  }
  async function pickStorm() {
    modal.open({ tab: "card" });
    await settle(modal);
    await click("[data-card-slot='background']");
    await click("[data-card-filter='all']");
    await click("[data-card-pick='cardBackground:bg_storm'] [data-tile-main]");
  }

  it("closing with an unowned item: the guard counts it, Save is off, Discard drops it", async () => {
    await pickStorm();
    q<HTMLButtonElement>("[slot='header'] button")!.click();
    await settle(modal);
    expect(q("[data-card-guard]")!.dataset.count).toBe("1");
    expect(q<HTMLButtonElement>("[data-card-guard-save]")!.disabled).toBe(true);
    expect(q("[data-card-guard-buy-first]")).not.toBeNull();
    await click("[data-card-guard-discard]");
    expect(modal.isOpen()).toBe(false);
    modal.open({ tab: "card" });
    await settle(modal);
    expect(q("[data-card-save-bar]")).toBeNull();
    expect(q("[data-card-slot='background']")!.textContent).not.toContain(
      "inventory_card.was",
    );
  });

  it("the fresh profile a purchase broadcasts keeps the changes, with no reload", async () => {
    await pickStorm();
    const tab = q("inventory-card-tab");
    expect(q("[data-card-buy='cardBackground:bg_storm']")).not.toBeNull();
    const fresh = owner([...OWNER, "cardBackground:bg_storm"]);
    vi.mocked(getUserMe).mockResolvedValue(fresh);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    await settle(modal);
    // The same tab, never the loading skeleton in between.
    expect(q("inventory-card-tab")).toBe(tab);
    expect(q("[data-card-buy]")).toBeNull();
    expect(q<HTMLButtonElement>("[data-card-save]")!.disabled).toBe(false);
    expect(q("[data-card-change-count]")).not.toBeNull();
  });

  /** Opens <purchase-button>'s confirm box for a currency, the way a tap
   * on its button does (the tap check runs first). */
  async function openConfirm(within: string, method: "hard" | "soft") {
    const button = q(`${within} purchase-button`) as unknown as {
      requestCurrencyPurchase(m: "hard" | "soft"): void;
    };
    button.requestCurrencyPurchase(method);
    await settle(modal);
    expect(q(`${within} confirm-dialog`)).not.toBeNull();
  }

  /** A Buy tap that finds the session signed out. */
  async function buySignedOut(within: string, method: "hard" | "soft") {
    vi.mocked(checkInPlacePurchase).mockResolvedValueOnce({
      ok: false,
      reason: "signed_out",
    } as never);
    const button = q(`${within} purchase-button`) as unknown as {
      requestCurrencyPurchase(m: "hard" | "soft"): void;
    };
    button.requestCurrencyPurchase(method);
    await settle(modal);
  }

  it("a Buy that finds the session signed out asks about the changes before Account", async () => {
    const showPage = vi.fn();
    window.showPage = showPage;
    await pickStorm();
    await buySignedOut("[data-card-buy='cardBackground:bg_storm']", "soft");
    expect(q("[data-card-guard]")).not.toBeNull();
    expect(showPage).not.toHaveBeenCalled();
    await click("[data-card-guard-discard]");
    expect(showPage).toHaveBeenCalledWith("page-account");
  });

  it("signed out with no changes (the no-card screen): straight to Account", async () => {
    const showPage = vi.fn();
    window.showPage = showPage;
    vi.mocked(getUserMe).mockResolvedValue(
      owner(["cardBackground:bg_pacific"]),
    );
    modal.open({ tab: "card" });
    await settle(modal);
    await buySignedOut("[data-card-get-card]", "hard");
    expect(q("[data-card-guard]")).toBeNull();
    expect(showPage).toHaveBeenCalledWith("page-account");
  });

  it("Escape with the Save bar's buy confirm open closes the confirm, not the Inventory", async () => {
    await pickStorm();
    await openConfirm("[data-card-buy='cardBackground:bg_storm']", "soft");
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.removeEventListener("keydown", behind);
    await settle(modal);
    expect(q("confirm-dialog")).toBeNull();
    expect(q("[data-card-guard]")).toBeNull();
    expect(behind).not.toHaveBeenCalled();
    expect(modal.isOpen()).toBe(true);
    // The change is still there.
    expect(q("[data-card-buy='cardBackground:bg_storm']")).not.toBeNull();
  });

  it("Escape with the no-card screen's buy confirm open closes only the confirm", async () => {
    const noCard = owner(["cardBackground:bg_pacific"]);
    vi.mocked(getUserMe).mockResolvedValue(noCard);
    modal.open({ tab: "card" });
    await settle(modal);
    await openConfirm("[data-card-get-card]", "hard");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle(modal);
    expect(q("confirm-dialog")).toBeNull();
    expect(modal.isOpen()).toBe(true);
    expect(q("[data-card-get-card]")).not.toBeNull();
  });
});
