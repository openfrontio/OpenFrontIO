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
import {
  type CardLoadoutBody,
  saveCardLoadout,
} from "../../src/client/CardLoadoutApi";
import {
  clearPendingPurchase,
  peekPendingPurchase,
} from "../../src/client/components/inventory/PendingEquip";
import {
  broadcastFreshUserMe,
  checkInPlacePurchase,
  fetchCosmetics,
} from "../../src/client/Cosmetics";
import { COSMETICS_CHANGED } from "../../src/client/Experiments";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
}));
// The account the session is signed in as (Auth's currentPublicId).
const session = vi.hoisted(() => ({
  id: "guard-test-player" as string | null,
}));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  userAuth: vi.fn(),
  currentPublicId: () => session.id,
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
    session.id = "guard-test-player";
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

  describe("hash routes", () => {
    // A stand-in for the Store: the router opens it by tag.
    const storeOpens: unknown[] = [];
    if (customElements.get("guard-test-store") === undefined) {
      customElements.define(
        "guard-test-store",
        class extends HTMLElement {
          open(args?: Record<string, unknown>) {
            storeOpens.push(args);
          }
          close() {}
        },
      );
    }
    beforeEach(() => {
      history.replaceState(null, "", "/");
      storeOpens.length = 0;
      document.body.appendChild(document.createElement("guard-test-store"));
      modalRouter.register("inventory", {
        tag: "inventory-modal",
        pageId: "page-inventory",
      });
      modalRouter.register("store", {
        tag: "guard-test-store",
        pageId: "page-item-store",
      });
    });
    // What Main's hashchange handler does for a hash that names no modal
    // (browser Back to the home page, or the hash cleared by hand).
    async function back() {
      history.replaceState(null, "", "/");
      expect(modalRouter.isHashRouted()).toBe(false);
      modalRouter.closeCurrent();
      await settle(modal);
    }

    it("Back with an unsaved change asks first; Keep editing stays, and the URL names the Inventory again", async () => {
      await openWithChange();
      const hash = window.location.hash;
      expect(hash).toContain("modal=inventory");
      await back();
      expect(q("[data-card-guard]")).not.toBeNull();
      expect(modal.isOpen()).toBe(true);
      await click("[data-card-guard-keep]");
      expect(modal.isOpen()).toBe(true);
      expect(window.location.hash).toBe(hash);
      expect(q("[data-card-save-bar]")).not.toBeNull();
    });

    it("a hash naming another Inventory tab, then Keep editing: the URL names the card tab again", async () => {
      await openWithChange();
      expect(window.location.hash).toContain("tab=card");
      history.replaceState(null, "", "/#modal=inventory&tab=skins");
      modalRouter.routeFromHash();
      await settle(modal);
      expect(q("[data-card-guard]")).not.toBeNull();
      await click("[data-card-guard-keep]");
      expect(onCardTab()).toBe(true);
      expect(window.location.hash).toContain("modal=inventory");
      expect(window.location.hash).toContain("tab=card");
      expect(window.location.hash).not.toContain("tab=skins");
    });

    // A popup (no pageId) over the Inventory page.
    const popupOpens: unknown[] = [];
    if (customElements.get("guard-test-popup") === undefined) {
      customElements.define(
        "guard-test-popup",
        class extends HTMLElement {
          open(args?: Record<string, unknown>) {
            popupOpens.push(args);
          }
          close() {}
        },
      );
    }
    async function openPopupOverChange() {
      document.body.appendChild(document.createElement("guard-test-popup"));
      modalRouter.register("popup", { tag: "guard-test-popup" });
      await openWithChange();
      history.replaceState(null, "", "/#modal=popup");
      expect(modalRouter.routeFromHash()).toBe(true);
      await settle(modal);
      await vi.waitFor(() => expect(popupOpens.length).toBeGreaterThan(0));
    }

    it("a route to another page from a popup over the Inventory asks the Inventory first", async () => {
      await openPopupOverChange();
      history.replaceState(null, "", "/#modal=store&tab=packs");
      modalRouter.routeFromHash();
      await settle(modal);
      expect(q("[data-card-guard]")).not.toBeNull();
      expect(storeOpens).toHaveLength(0);
      await click("[data-card-guard-keep]");
      expect(storeOpens).toHaveLength(0);
      expect(modal.isOpen()).toBe(true);
      expect(window.location.hash).toBe("#modal=popup");
    });

    it("once the popup closes, Back still asks the Inventory underneath", async () => {
      await openPopupOverChange();
      modalRouter.syncClosed("popup");
      // The URL names the Inventory again.
      expect(window.location.hash).toContain("modal=inventory");
      await back();
      expect(q("[data-card-guard]")).not.toBeNull();
      expect(modal.isOpen()).toBe(true);
      await click("[data-card-guard-keep]");
      expect(window.location.hash).toContain("modal=inventory");
    });

    it("a page whose route the URL left before it opened isn't named again when a popup closes", async () => {
      document.body.appendChild(document.createElement("guard-test-popup"));
      modalRouter.register("popup", { tag: "guard-test-popup" });
      // Nothing routed yet (an earlier test's modal would be asked first).
      Object.assign(modalRouter, { currentName: null, page: null });
      history.replaceState(null, "", "/#modal=store&tab=packs");
      modalRouter.routeFromHash();
      // The URL moves on to a popup before the Store has loaded.
      history.replaceState(null, "", "/#modal=popup");
      modalRouter.routeFromHash();
      await vi.waitFor(() => expect(popupOpens.length).toBeGreaterThan(0));
      await settle(modal);
      modalRouter.syncClosed("popup");
      expect(window.location.hash).toBe("");
    });

    // The app's own showPage (Navigation), which closes the page shown
    // before it opens the one asked for.
    describe("with the real showPage", () => {
      let realShowPage: (pageId: string) => void;
      beforeAll(() => {
        const before = window.showPage;
        initNavigation();
        realShowPage = window.showPage!;
        window.showPage = before;
      });
      beforeEach(() => {
        modal.id = "page-inventory";
        modal.classList.add("page-content", "hidden");
        window.showPage = realShowPage;
      });
      afterEach(() => {
        window.showPage = undefined;
      });
      const changes = () =>
        (
          modal as unknown as { cardEditor: { changeCount(): number } }
        ).cardEditor.changeCount();

      it("a hash naming another Inventory tab asks first, and Keep editing keeps the change", async () => {
        await openWithChange();
        expect(changes()).toBe(1);
        history.replaceState(null, "", "/#modal=inventory&tab=skins");
        modalRouter.routeFromHash();
        await settle(modal);
        expect(q("[data-card-guard]")).not.toBeNull();
        expect(changes()).toBe(1);
        await click("[data-card-guard-keep]");
        expect(modal.isOpen()).toBe(true);
        expect(onCardTab()).toBe(true);
        expect(changes()).toBe(1);
        expect(window.location.hash).toContain("tab=card");
      });

      it("Back from a popup to the Inventory's own hash keeps the change", async () => {
        await openPopupOverChange();
        history.replaceState(null, "", "/#modal=inventory&tab=card");
        modalRouter.routeFromHash();
        await settle(modal);
        expect(modal.isOpen()).toBe(true);
        expect(onCardTab()).toBe(true);
        expect(changes()).toBe(1);
      });
    });

    it("Back with an unsaved change, then Discard: closes, and the change is gone", async () => {
      await openWithChange();
      await back();
      await click("[data-card-guard-discard]");
      expect(modal.isOpen()).toBe(false);
      expect(window.location.hash).toBe("");
      modal.open({ tab: "card" });
      await settle(modal);
      expect(q("[data-card-save-bar]")).toBeNull();
    });

    it("Back with an unsaved change, then Save: saves, then closes", async () => {
      vi.mocked(saveCardLoadout).mockResolvedValue({
        ok: true,
        loadout: {} as never,
      });
      await openWithChange();
      await back();
      await click("[data-card-guard-save]");
      expect(saveCardLoadout).toHaveBeenCalledTimes(1);
      expect(modal.isOpen()).toBe(false);
    });

    it("Back with no changes closes at once", async () => {
      modal.open({ tab: "card" });
      await settle(modal);
      await back();
      expect(q("[data-card-guard]")).toBeNull();
      expect(modal.isOpen()).toBe(false);
    });

    // Main routes a Back or a typed hash twice: on popstate, then on
    // hashchange. The second must not answer the first's prompt.
    for (const choice of ["discard", "save"] as const) {
      it(`a typed hash to the Store, routed twice, then ${choice}: the Store opens`, async () => {
        vi.mocked(saveCardLoadout).mockResolvedValue({
          ok: true,
          loadout: {} as never,
        });
        await openWithChange();
        history.replaceState(null, "", "/#modal=store&tab=packs");
        expect(modalRouter.routeFromHash()).toBe(true);
        expect(modalRouter.routeFromHash()).toBe(true);
        await settle(modal);
        expect(q("[data-card-guard]")).not.toBeNull();
        await click(`[data-card-guard-${choice}]`);
        await vi.waitFor(() => expect(storeOpens).toHaveLength(1));
        expect(storeOpens[0]).toEqual({ tab: "packs" });
        expect(window.location.hash).toBe("#modal=store&tab=packs");
        expect(
          (modalRouter as unknown as { currentName: string | null })
            .currentName,
        ).toBe("store");
      });
    }

    it("another route while the Store route's prompt is up: Discard still opens the Store, with its own hash", async () => {
      await openWithChange();
      history.replaceState(null, "", "/#modal=store&tab=packs");
      modalRouter.routeFromHash();
      await settle(modal);
      // The player navigates again before answering (Back, say).
      history.replaceState(null, "", "/");
      modalRouter.closeCurrent();
      await settle(modal);
      await click("[data-card-guard-discard]");
      await vi.waitFor(() => expect(storeOpens).toHaveLength(1));
      expect(window.location.hash).toBe("#modal=store&tab=packs");
      expect(
        (modalRouter as unknown as { currentName: string | null }).currentName,
      ).toBe("store");
    });

    it("a route typed while Back's prompt is up, then Discard: the Inventory closes and the URL is Back's", async () => {
      await openWithChange();
      history.replaceState(null, "", "/");
      modalRouter.closeCurrent();
      await settle(modal);
      history.replaceState(null, "", "/#modal=store&tab=packs");
      modalRouter.routeFromHash();
      await settle(modal);
      await click("[data-card-guard-discard]");
      expect(modal.isOpen()).toBe(false);
      expect(window.location.hash).toBe("");
      expect(storeOpens).toHaveLength(0);
    });

    it("Back to another path and query, then a same-page move while it asks: Discard closes at Back's whole URL", async () => {
      await openWithChange();
      // Back lands on /?view=home...
      history.replaceState(null, "", "/?view=home");
      modalRouter.closeCurrent();
      await settle(modal);
      // ...and another same-document move changes path, query and hash.
      history.replaceState(null, "", "/other?view=other#modal=store&tab=packs");
      modalRouter.routeFromHash();
      await settle(modal);
      await click("[data-card-guard-discard]");
      expect(modal.isOpen()).toBe(false);
      expect(window.location.pathname).toBe("/");
      expect(window.location.search).toBe("?view=home");
      expect(window.location.hash).toBe("");
      expect(storeOpens).toHaveLength(0);
    });

    it("a route to the Store with a query, then a move while it asks: Discard opens the Store at that whole URL", async () => {
      await openWithChange();
      history.replaceState(null, "", "/?ref=news#modal=store&tab=packs");
      modalRouter.routeFromHash();
      await settle(modal);
      history.replaceState(null, "", "/elsewhere?ref=other");
      modalRouter.closeCurrent();
      await settle(modal);
      await click("[data-card-guard-discard]");
      expect(storeOpens).toHaveLength(1);
      expect(window.location.pathname).toBe("/");
      expect(window.location.search).toBe("?ref=news");
      expect(window.location.hash).toBe("#modal=store&tab=packs");
    });

    it("another route while the prompt is up, then Keep editing: the Inventory stays, and its hash comes back", async () => {
      await openWithChange();
      const hash = window.location.hash;
      history.replaceState(null, "", "/#modal=store&tab=packs");
      modalRouter.routeFromHash();
      await settle(modal);
      history.replaceState(null, "", "/");
      modalRouter.closeCurrent();
      await settle(modal);
      await click("[data-card-guard-keep]");
      expect(modal.isOpen()).toBe(true);
      expect(window.location.hash).toBe(hash);
      expect(storeOpens).toHaveLength(0);
      expect(
        (modalRouter as unknown as { currentName: string | null }).currentName,
      ).toBe("inventory");
    });

    it("Back routed twice, then Discard: closes once, and the URL stays clear", async () => {
      await openWithChange();
      history.replaceState(null, "", "/");
      modalRouter.closeCurrent();
      modalRouter.closeCurrent();
      await settle(modal);
      await click("[data-card-guard-discard]");
      expect(modal.isOpen()).toBe(false);
      expect(window.location.hash).toBe("");
    });

    it("a route to the Store with an unsaved change asks first; Keep editing stays", async () => {
      await openWithChange();
      const hash = window.location.hash;
      history.replaceState(null, "", "/#modal=store&tab=packs");
      expect(modalRouter.routeFromHash()).toBe(true);
      await settle(modal);
      expect(q("[data-card-guard]")).not.toBeNull();
      await click("[data-card-guard-keep]");
      expect(modal.isOpen()).toBe(true);
      expect(window.location.hash).toBe(hash);
    });
  });

  it("the guard's Save is off when the editor can't save (the account unknown for now)", async () => {
    await openWithChange();
    // A token refresh failed: no session account, the draft is kept.
    session.id = null;
    await click("[data-inventory-top-tab='ingame']");
    expect(q("[data-card-guard]")).not.toBeNull();
    expect(q<HTMLButtonElement>("[data-card-guard-save]")!.disabled).toBe(true);
    // Nothing to buy: no "buy it first" note.
    expect(q("[data-card-guard-buy-first]")).toBeNull();
    // Discard and Keep editing still work.
    expect(q<HTMLButtonElement>("[data-card-guard-discard]")!.disabled).toBe(
      false,
    );
    await click("[data-card-guard-keep]");
    expect(onCardTab()).toBe(true);
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

  // What a save of openWithChange's change stores.
  const STORED = {
    background: "bg_pacific",
    title: null,
    taunt: null,
    trackers: ["wins", "nukes_launched", "games_played"],
  } as CardLoadoutBody;

  it("a save's /users/@me refresh keeps the same card tab, still on Trackers", async () => {
    vi.mocked(saveCardLoadout).mockResolvedValue({ ok: true, loadout: STORED });
    await openWithChange();
    const tab = q("inventory-card-tab");
    const picker = q("[data-card-picker]")?.dataset.cardPicker;
    expect(picker).toBe("tracker:2");
    await click("[data-card-save]");
    // The refresh the save broadcasts.
    const fresh = owner();
    fresh.player.card!.trackers = [
      { stat: "wins", value: 312 },
      { stat: "nukes_launched", value: 4880 },
      { stat: "games_played", value: 900 },
    ];
    vi.mocked(getUserMe).mockResolvedValue(fresh);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    // Mid-refresh too: no loading skeleton in its place.
    await modal.updateComplete;
    expect(q("inventory-card-tab")).toBe(tab);
    await settle(modal);
    expect(q("inventory-card-tab")).toBe(tab);
    expect(q("[data-card-picker]")?.dataset.cardPicker).toBe("tracker:2");
  });

  it("a save's refresh whose catalogue fetch fails keeps the card tab on screen", async () => {
    // Open, the Inventory takes a fresh profile in place and fetches no
    // catalogue; closed, it reloads, and that reload's fetch can fail. The
    // catalogue already loaded stays, so reopening shows the card tab with
    // the saved card, not the error view. (Closed renders nothing, so the
    // tab itself is a new one.)
    vi.mocked(saveCardLoadout).mockResolvedValue({ ok: true, loadout: STORED });
    await openWithChange();
    await click("[data-card-save]");
    await click("[slot='header'] button");
    expect(modal.isOpen()).toBe(false);
    vi.mocked(fetchCosmetics).mockResolvedValue(null);
    const fresh = owner();
    fresh.player.card!.trackers = [
      { stat: "wins", value: 312 },
      { stat: "nukes_launched", value: 4880 },
      { stat: "games_played", value: 900 },
    ];
    vi.mocked(getUserMe).mockResolvedValue(fresh);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    await settle(modal);
    expect(vi.mocked(fetchCosmetics).mock.calls.length).toBe(2);
    modal.open({ tab: "card" });
    await settle(modal);
    expect(q("[data-inventory-state='error']")).toBeNull();
    expect(q("inventory-card-tab")).not.toBeNull();
    expect(q("[data-card-slot-row='tracker:2']")!.textContent).toContain(
      "games_played",
    );
    expect(q("[data-card-change-count]")).toBeNull();
  });

  it("a save's refresh that throws keeps the card tab on screen", async () => {
    // As above, with the closed reload throwing rather than answering null.
    vi.mocked(saveCardLoadout).mockResolvedValue({ ok: true, loadout: STORED });
    await openWithChange();
    await click("[data-card-save]");
    await click("[slot='header'] button");
    expect(modal.isOpen()).toBe(false);
    vi.mocked(fetchCosmetics).mockRejectedValue(new Error("offline"));
    const fresh = owner();
    fresh.player.card!.trackers = [
      { stat: "wins", value: 312 },
      { stat: "nukes_launched", value: 4880 },
      { stat: "games_played", value: 900 },
    ];
    vi.mocked(getUserMe).mockResolvedValue(fresh);
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    await settle(modal);
    expect(vi.mocked(fetchCosmetics).mock.calls.length).toBe(2);
    modal.open({ tab: "card" });
    await settle(modal);
    expect(q("[data-inventory-state='error']")).toBeNull();
    expect(q("inventory-card-tab")).not.toBeNull();
    expect(q("[data-card-slot-row='tracker:2']")!.textContent).toContain(
      "games_played",
    );
    expect(q("[data-card-change-count]")).toBeNull();
  });

  it("a save whose refresh failed: a remade card tab and the next save start from what was stored", async () => {
    vi.mocked(saveCardLoadout).mockResolvedValue({ ok: true, loadout: STORED });
    await openWithChange();
    await click("[data-card-save]");
    // No userMeResponse: the refresh after the save failed, so the
    // Inventory's profile still holds the card from before.
    await click("[data-inventory-top-tab='ingame']");
    await click("[data-inventory-top-tab='card']");
    // The stored card, with no changes against it ("Saved" may still show).
    expect(q("[data-card-change-count]")).toBeNull();
    // best_elo into row 1. From the stored card it replaces wins; from the
    // old one (best_elo in row 3) it would swap wins down there.
    await click("[data-card-slot-row='tracker:0'] [data-card-row-open]");
    await click("[data-card-pick='cardTracker:best_elo'] [data-tile-main]");
    await click("[data-card-save]");
    expect(saveCardLoadout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        trackers: ["best_elo", "nukes_launched", "games_played"],
      }),
      expect.any(Function),
    );
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
    // The old profile is no longer shown to edit, and Save stays off.
    expect(q("[data-card-slot-row='tracker:2']")).toBeNull();
    expect(cardEditor().canSave()).toBe(false);
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

  const cardEditor = () =>
    (modal as unknown as { cardEditor: CardEditorLike }).cardEditor;

  it("the card tab opened after a switch never seeds the old account's profile", async () => {
    const a = owner();
    vi.mocked(getUserMe).mockResolvedValue(a);
    modal.open({ tab: "skins" });
    await settle(modal);
    document.dispatchEvent(new CustomEvent("session-reauth"));
    session.id = "account-b";
    await click("[data-inventory-top-tab='card']");
    expect(cardEditor().isSeededWith(a)).toBe(false);
    expect(cardEditor().canSave()).toBe(false);
  });

  it("a broadcast of the old account's profile after a switch is ignored", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    document.dispatchEvent(new CustomEvent("session-reauth"));
    session.id = "account-b";
    const late = owner();
    document.dispatchEvent(new CustomEvent("userMeResponse", { detail: late }));
    await settle(modal);
    expect(cardEditor().isSeededWith(late)).toBe(false);
    expect(cardEditor().canSave()).toBe(false);
    q<HTMLButtonElement>("[data-card-save]")?.click();
    await settle(modal);
    expect(saveCardLoadout).not.toHaveBeenCalled();
  });

  it("the old account's profile after a switch never reaches the Inventory; the new one's does", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    const shown = () =>
      (modal as unknown as { userMeResponse: UserMeResponse | false })
        .userMeResponse;
    document.dispatchEvent(new CustomEvent("session-reauth"));
    session.id = "account-b";
    await settle(modal);
    // A's profile, in place (the open Inventory's refresh path) and as a
    // load: neither is taken.
    const late = owner();
    document.dispatchEvent(new CustomEvent("userMeResponse", { detail: late }));
    await settle(modal);
    expect(shown()).not.toBe(late);
    await modal.onUserMe(late);
    expect(shown()).not.toBe(late);
    // B's renders as usual.
    const b = owner();
    (b.player as { publicId: string }).publicId = "account-b";
    document.dispatchEvent(new CustomEvent("userMeResponse", { detail: b }));
    await settle(modal);
    expect(shown()).toBe(b);
    expect(cardEditor().isSeededWith(b)).toBe(true);
  });

  it("a profile that names no account isn't taken for another account's", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    const fresh = owner();
    delete (fresh.player as { publicId?: string }).publicId;
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    await settle(modal);
    expect(
      (modal as unknown as { userMeResponse: UserMeResponse | false })
        .userMeResponse,
    ).toBe(fresh);
  });

  it("a profile while the session's account is unknown for now is still shown", async () => {
    modal.open({ tab: "card" });
    await settle(modal);
    session.id = null;
    const fresh = owner();
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: fresh }),
    );
    await settle(modal);
    expect(
      (modal as unknown as { userMeResponse: UserMeResponse | false })
        .userMeResponse,
    ).toBe(fresh);
  });

  it("a background sign-out with the Inventory open ends signed out, not loading", async () => {
    // Main hears session-cleared first (it registers at boot) and
    // re-broadcasts the signed-out profile at once.
    const mainLike = () =>
      document.dispatchEvent(
        new CustomEvent("userMeResponse", { detail: false }),
      );
    modal.remove();
    document.addEventListener("session-cleared", mainLike);
    try {
      document.body.appendChild(modal);
      modal.open({ tab: "card" });
      await settle(modal);
      vi.mocked(userAuth).mockResolvedValue(false);
      session.id = null;
      document.dispatchEvent(new CustomEvent("session-cleared"));
      await settle(modal);
      expect(q("[data-inventory-sign-in]")).not.toBeNull();
      expect(
        (modal as unknown as { ownershipState: string }).ownershipState,
      ).toBe("guest");
    } finally {
      document.removeEventListener("session-cleared", mainLike);
    }
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

  it("a catalogue change re-prices the card tab's buy buttons", async () => {
    await pickStorm();
    const buy = () =>
      q(
        "[data-card-buy='cardBackground:bg_storm'] purchase-button",
      ) as unknown as {
        priceSoft: number | null;
      };
    expect(buy().priceSoft).toBe(2400);
    // A store-experiment group changed, or a price_changed refusal reloaded
    // the catalogue: the retry must send the price now.
    const raised = catalog();
    (raised.cardBackgrounds!.bg_storm as { priceSoft: number }).priceSoft =
      2600;
    document.dispatchEvent(
      new CustomEvent(COSMETICS_CHANGED, { detail: raised }),
    );
    await settle(modal);
    expect(buy().priceSoft).toBe(2600);
    // The pick survives the new catalogue.
    expect(q("[data-card-change-count]")).not.toBeNull();
  });

  it("a catalogue change re-prices the no-card screen's buy button", async () => {
    vi.mocked(getUserMe).mockResolvedValue(
      owner(["cardBackground:bg_pacific"]),
    );
    modal.open({ tab: "card" });
    await settle(modal);
    const buy = () =>
      q("[data-card-get-card] purchase-button") as unknown as {
        priceHard: number | null;
      };
    expect(buy().priceHard).toBe(300);
    const raised = catalog();
    (raised.playerCards!.standard as { priceHard: number }).priceHard = 450;
    document.dispatchEvent(
      new CustomEvent(COSMETICS_CHANGED, { detail: raised }),
    );
    await settle(modal);
    expect(buy().priceHard).toBe(450);
  });

  /** Opens <purchase-button>'s confirm box for a currency, the way a tap
   * on its button does (the tap check runs first). The check is answered
   * here rather than by the real one: that reads the profile through
   * Cosmetics and Api, and the client project's vmThreads pool can hand a
   * file module instances another file evaluated (bound to that file's
   * mocks), so it could answer "unreachable" and show an alert instead of
   * the confirm. These tests are about Escape, not the tap check. */
  async function openConfirm(within: string, method: "hard" | "soft") {
    vi.mocked(checkInPlacePurchase).mockResolvedValueOnce({
      ok: true,
      balance: 5000,
    });
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
