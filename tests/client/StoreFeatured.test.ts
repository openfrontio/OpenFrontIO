import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CosmeticCard } from "../../src/client/components/CosmeticCard";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";
import {
  cosmeticsCacheIsStale,
  fetchCosmetics,
  getCachedCosmetics,
  purchaseCosmetic,
  refreshStaleCosmetics,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";
import "../../src/client/Store";
import type { StoreModal } from "../../src/client/Store";

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(),
  cosmeticsCacheIsStale: vi.fn(() => false),
  getCachedCosmetics: vi.fn(() => null),
  purchaseCosmetic: vi.fn(),
  refreshStaleCosmetics: vi.fn(() => false),
  resolveCosmetics: vi.fn(),
}));

// The store's private state, read the way the existing store tests do.
type Internals = {
  activeTab: string;
  cosmetics: Cosmetics | null;
  userMeResponse: UserMeResponse | false;
  dealRollover: { height: number | null } | null;
  modalConfig(): { tabs?: { key: string }[] };
  placementFor(el: Element): unknown;
};
const internals = (modal: StoreModal) => modal as unknown as Internals;
const tabKeys = (modal: StoreModal) =>
  (internals(modal).modalConfig().tabs ?? []).map((tab) => tab.key);
const activeTab = (modal: StoreModal) => internals(modal).activeTab;

const hour = () => new Date(Date.now() + 3_600_000).toISOString();
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function skin(
  name: string,
  extra: Record<string, unknown> = {},
  relationship: ResolvedCosmetic["relationship"] = "purchasable",
): ResolvedCosmetic {
  return {
    type: "pattern",
    cosmetic: {
      name,
      pattern: "AAAAAA",
      product: null,
      priceHard: 120,
      rarity: "rare",
      affiliateCode: null,
      ...extra,
    } as never,
    colorPalette: null,
    relationship,
    key: `pattern:${name}`,
  };
}

function flashPromotion(endsAt: string, id = "flash-1") {
  return { id, name: "Flash", percentOff: 50, endsAt, kind: "flash" as const };
}
function regularPromotion(endsAt: string, id = "sale-1") {
  return { id, name: "Autumn", percentOff: 25, endsAt };
}
const discounted = (promotion: object) => ({
  priceHard: 60,
  listPriceHard: 120,
  promotion,
});

/** A catalog the store's banner and owned strip can read item names from. */
function catalog(
  promotions: object[],
  patterns: Record<string, object> = {},
): Cosmetics {
  return { patterns, flags: {}, promotions } as unknown as Cosmetics;
}

let resolvedCatalog: ResolvedCosmetic[];
// Every store a test mounts, so afterEach removes them all, not just the last.
const stores: StoreModal[] = [];

async function mountStore(): Promise<StoreModal> {
  const store = document.createElement("store-modal") as StoreModal;
  store.inline = true;
  document.body.appendChild(store);
  stores.push(store);
  await store.updateComplete;
  return store;
}

/** Waits for the store to finish its open (the catalog fetch included). */
async function settle(modal: StoreModal) {
  const state = modal as unknown as {
    catalogRequest: number;
    settledCatalogRequest: number;
  };
  await vi.waitFor(() =>
    expect(state.settledCatalogRequest).toBe(state.catalogRequest),
  );
  // onOpen's own refresh, after the fetch.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await modal.updateComplete;
}

/**
 * A window width for matchMedia, which jsdom lacks. Returns a resize that
 * fires the change listeners of the queries it flips.
 */
function fakeWidth(px: number): ((next: number) => void) & {
  listeners: () => number;
} {
  let width = px;
  const lists: { query: string; listeners: Set<() => void> }[] = [];
  const matches = (query: string) =>
    width >= Number(/min-width: (\d+)rem/.exec(query)![1]) * 16;
  window.matchMedia = ((query: string) => {
    const list = { query, listeners: new Set<() => void>() };
    lists.push(list);
    return {
      get matches() {
        return matches(query);
      },
      addEventListener: (_: string, fn: () => void) => list.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) =>
        list.listeners.delete(fn),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  const resize = (next: number) => {
    const before = lists.map((list) => matches(list.query));
    width = next;
    lists.forEach((list, i) => {
      if (matches(list.query) !== before[i]) {
        for (const fn of list.listeners) fn();
      }
    });
  };
  return Object.assign(resize, {
    listeners: () =>
      lists.reduce((total, list) => total + list.listeners.size, 0),
  });
}

const cardKeys = (root: ParentNode) =>
  [...root.querySelectorAll<CosmeticCard>("cosmetic-card")].map(
    (c) => c.resolved.key,
  );

describe("store Featured tab", () => {
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  beforeEach(() => {
    localStorage.clear();
    resolvedCatalog = [skin("plain")];
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue(catalog([]));
    vi.mocked(getCachedCosmetics).mockReset();
    vi.mocked(getCachedCosmetics).mockReturnValue(null);
    vi.mocked(refreshStaleCosmetics).mockReset();
    vi.mocked(refreshStaleCosmetics).mockReturnValue(false);
    vi.mocked(cosmeticsCacheIsStale).mockReset();
    vi.mocked(cosmeticsCacheIsStale).mockReturnValue(false);
    vi.mocked(resolveCosmetics).mockReset();
    vi.mocked(resolveCosmetics).mockImplementation(
      (_cosmetics, _userMe, affiliateCode) =>
        affiliateCode
          ? resolvedCatalog.filter(
              (item) =>
                (item.cosmetic as { affiliateCode?: string | null })
                  .affiliateCode === affiliateCode,
            )
          : resolvedCatalog,
    );
    vi.mocked(purchaseCosmetic).mockReset();
    vi.mocked(purchaseCosmetic).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    for (const mounted of stores.splice(0)) mounted.remove();
    vi.useRealTimers();
    localStorage.clear();
  });

  describe("which tab an open lands on", () => {
    beforeEach(() => {
      resolvedCatalog = [skin("plain"), skin("fresh", { newUntil: days(3) })];
    });

    it("lands an untargeted open on Featured, first in the tab row, and again after a reopen", async () => {
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(tabKeys(modal)[0]).toBe("featured");
      expect(activeTab(modal)).toBe("featured");

      modal.setActiveTab("effects");
      modal.close();
      modal.open();
      expect(activeTab(modal)).toBe("featured");
    });

    it("lands on Featured when nav Store closes and reopens the store", async () => {
      const modal = await mountStore();
      modal.open({ tab: "packs" });
      await settle(modal);
      expect(activeTab(modal)).toBe("packs");
      modal.close();
      modal.open();
      expect(activeTab(modal)).toBe("featured");
    });

    it("keeps Featured through the router's second, arg-less open", async () => {
      const modal = await mountStore();
      modal.open();
      modal.open({});
      await settle(modal);
      expect(activeTab(modal)).toBe("featured");
    });

    it("lets an explicit tab win, on a fresh open and on the router's second open", async () => {
      for (const tab of ["packs", "subscriptions", "effects"]) {
        const modal = await mountStore();
        modal.open();
        modal.open({ tab });
        expect(activeTab(modal)).toBe(tab);
        modal.remove();
      }
      const modal = await mountStore();
      modal.open({ tab: "cosmetics", item: "pattern:fresh" });
      expect(activeTab(modal)).toBe("cosmetics");
      // The router's form of an item link.
      modal.close();
      modal.open();
      modal.open({ tab: "cosmetics", item: "pattern:fresh" });
      expect(activeTab(modal)).toBe("cosmetics");
    });

    it("opens Cosmetics on its current sub-tab with tab=cosmetics", async () => {
      const modal = await mountStore();
      modal.open();
      modal.open({ tab: "cosmetics" });
      await settle(modal);
      expect(activeTab(modal)).toBe("cosmetics");
      expect(
        modal
          .querySelector('[data-store-subtab="patterns"]')
          ?.className.includes("text-aquarius"),
      ).toBe(true);
    });

    it("opens Cosmetics → New for sub=new with no tab", async () => {
      const modal = await mountStore();
      modal.open({ sub: "new" });
      await settle(modal);
      expect(activeTab(modal)).toBe("cosmetics");
      expect(cardKeys(modal)).toEqual(["pattern:fresh"]);

      // The router's form: an arg-less open, then the args.
      modal.close();
      modal.open();
      modal.open({ sub: "new" });
      expect(activeTab(modal)).toBe("cosmetics");
    });

    it("lands an open with an unknown tab on Featured while it shows", async () => {
      const modal = await mountStore();
      modal.open({ tab: "bogus" });
      expect(activeTab(modal)).toBe("featured");
    });
  });

  describe("with nothing to feature", () => {
    beforeEach(() => {
      vi.mocked(getCachedCosmetics).mockReturnValue(catalog([]));
    });

    it("hides Featured and opens on Packs, even after the player last used Effects", async () => {
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(tabKeys(modal)).not.toContain("featured");
      expect(activeTab(modal)).toBe("packs");

      modal.setActiveTab("effects");
      modal.close();
      modal.open();
      expect(activeTab(modal)).toBe("packs");
    });

    it("treats tab=featured, and an unknown tab, as untargeted", async () => {
      const modal = await mountStore();
      modal.open({ tab: "effects" });
      modal.close();
      modal.open({ tab: "featured" });
      expect(activeTab(modal)).toBe("packs");

      modal.setActiveTab("effects");
      modal.close();
      modal.open();
      modal.open({ tab: "featured" });
      expect(activeTab(modal)).toBe("packs");

      modal.setActiveTab("effects");
      modal.close();
      modal.open({ tab: "bogus" });
      expect(activeTab(modal)).toBe("packs");
    });

    it("moves off a Featured tab left over from an open that showed it", async () => {
      vi.mocked(getCachedCosmetics).mockReturnValue(null);
      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(activeTab(modal)).toBe("featured");
      modal.close();

      // Nothing to feature now. An affiliate link sets no tab of its own,
      // so only the reset moves the store off the hidden Featured.
      resolvedCatalog = [skin("plain")];
      internals(modal).cosmetics = catalog([]);
      modal.open({ affiliateCode: "creator" });
      expect(tabKeys(modal)).not.toContain("featured");
      expect(activeTab(modal)).toBe("packs");

      // Targeted at an item: Cosmetics, never the hidden Featured.
      modal.close();
      (internals(modal) as { activeTab: string }).activeTab = "featured";
      modal.open({ item: "pattern:plain" });
      expect(activeTab(modal)).toBe("cosmetics");
    });
  });

  describe("loading, error and empty", () => {
    it("shows the skeleton on a cold open, then the content in place", async () => {
      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      let resolve: (c: Cosmetics) => void = () => {};
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics>((r) => (resolve = r)) as never,
      );
      const modal = await mountStore();
      modal.open();
      await modal.updateComplete;
      const loading = modal.querySelector("[data-featured-loading]")!;
      expect(loading.getAttribute("aria-busy")).toBe("true");
      expect(loading.textContent).toContain("common.loading");
      expect(activeTab(modal)).toBe("featured");

      resolve(catalog([]));
      await settle(modal);
      expect(
        cardKeys(modal.querySelector('[data-featured-section="new"]')!),
      ).toEqual(["pattern:fresh"]);
    });

    it("says nothing is featured when a cold open loads empty, and keeps the tab", async () => {
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(activeTab(modal)).toBe("featured");
      expect(
        modal.querySelector("[data-featured-empty]")?.textContent,
      ).toContain("store.featured_empty");
      expect(tabKeys(modal)).toContain("featured");
    });

    it("shows an error with Retry when a cold fetch fails, and Retry loads the store", async () => {
      vi.mocked(fetchCosmetics).mockResolvedValueOnce(null);
      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      const modal = await mountStore();
      modal.open();
      await vi.waitFor(() =>
        expect(modal.querySelector("[data-featured-error]")).toBeTruthy(),
      );
      expect(modal.textContent).toContain("store.load_failed");

      let resolve: (c: Cosmetics) => void = () => {};
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics>((r) => (resolve = r)) as never,
      );
      modal.querySelector<HTMLButtonElement>("[data-featured-retry]")!.click();
      await modal.updateComplete;
      expect(modal.querySelector("[data-featured-loading]")).toBeTruthy();
      resolve(catalog([]));
      await vi.waitFor(() =>
        expect(
          modal.querySelector('[data-featured-section="new"]'),
        ).toBeTruthy(),
      );
      expect(modal.querySelector("[data-featured-error]")).toBeNull();
    });

    it("renders from a stale cached catalog when the refetch fails", async () => {
      const cached = catalog([]);
      vi.mocked(getCachedCosmetics).mockReturnValue(cached);
      vi.mocked(refreshStaleCosmetics).mockReturnValue(true);
      vi.mocked(fetchCosmetics).mockResolvedValue(null);
      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      const modal = await mountStore();
      modal.open();
      await vi.waitFor(() => expect(fetchCosmetics).toHaveBeenCalled());
      await modal.updateComplete;
      expect(internals(modal).cosmetics).toBe(cached);
      expect(modal.querySelector("[data-featured-error]")).toBeNull();
      expect(modal.querySelector('[data-featured-section="new"]')).toBeTruthy();
    });
  });

  describe("sections", () => {
    it("shows the deal, then New, then On sale, each item once", async () => {
      const flash = flashPromotion(hour());
      const sale = regularPromotion(hour());
      const deal = skin("zap", discounted(flash));
      const newOnSale = skin("both", {
        ...discounted(sale),
        newUntil: days(3),
      });
      const onSale = skin("cheap", discounted(sale));
      resolvedCatalog = [skin("plain"), deal, newOnSale, onSale];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([flash, sale]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);

      const sections = [
        ...modal.querySelectorAll<HTMLElement>("[data-featured-section]"),
      ];
      expect(sections.map((el) => el.dataset.featuredSection)).toEqual([
        "deal",
        "new",
        "sale",
      ]);
      const [hero, fresh, discountedRow] = sections;
      expect(cardKeys(hero)).toEqual([deal.key]);
      expect(cardKeys(fresh)).toEqual([newOnSale.key]);
      expect(cardKeys(discountedRow)).toEqual([onSale.key]);

      // The Featured hero: compact on phones, a minimum height, the local
      // time of the next deal, and not placed as the On sale tab's flash.
      expect(hero.hasAttribute("data-store-flash")).toBe(false);
      expect(hero.className).toContain("min-h-56");
      expect(hero.className).toContain("sm:min-h-72");
      expect(
        hero.querySelector("[data-featured-deal-at]")?.textContent,
      ).toContain("store.featured_next_deal_at");
      expect(hero.querySelector("sale-countdown")).toBeTruthy();
      expect(hero.querySelectorAll("purchase-button")).toHaveLength(1);

      // The On sale tab's hero keeps its own classes.
      modal
        .querySelector<HTMLButtonElement>('[data-featured-see-all="sale"]')!
        .click();
      await modal.updateComplete;
      expect(activeTab(modal)).toBe("cosmetics");
      const tabHero = modal.querySelector("[data-store-flash]")!;
      expect(tabHero.className).not.toContain("min-h-56");
      expect(tabHero.querySelector("[data-featured-deal-at]")).toBeNull();
    });

    it("shows at most four cards a row", async () => {
      resolvedCatalog = ["a", "b", "c", "d", "e"].map((name, i) =>
        skin(name, { newUntil: days(i + 2) }),
      );
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      const row = modal.querySelector('[data-featured-section="new"]')!;
      const cards = [...row.querySelectorAll<CosmeticCard>("cosmetic-card")];
      expect(cards.map((c) => c.resolved.key)).toEqual([
        "pattern:e",
        "pattern:d",
        "pattern:c",
        "pattern:b",
      ]);
      for (const card of cards) expect(card.className).not.toContain("hidden");
      const seeAll = row.querySelector("[data-featured-see-all]")!;
      expect(seeAll.getAttribute("aria-describedby")).toBe(
        row.querySelector("h3")!.id,
      );
    });

    it("holds 2 cards a row on phones, 3 from sm and 4 from xl, as the width changes", async () => {
      const resize = fakeWidth(375);
      resolvedCatalog = ["a", "b", "c", "d", "e"].map((name, i) =>
        skin(name, { newUntil: days(i + 2) }),
      );
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      const row = () => modal.querySelector('[data-featured-section="new"]')!;
      expect(cardKeys(row())).toEqual(["pattern:e", "pattern:d"]);
      resize(700);
      await modal.updateComplete;
      expect(cardKeys(row())).toHaveLength(3);
      resize(1400);
      await modal.updateComplete;
      expect(cardKeys(row())).toHaveLength(4);
      // Removed, it stops listening; put back, it listens once again.
      expect(resize.listeners()).toBe(2);
      modal.remove();
      expect(resize.listeners()).toBe(0);
      document.body.appendChild(modal);
      expect(resize.listeners()).toBe(2);
    });

    it("on a phone, lists a 3rd new item on sale under On sale", async () => {
      fakeWidth(375);
      const sale = regularPromotion(hour());
      const third = skin("third", { ...discounted(sale), newUntil: days(3) });
      resolvedCatalog = [
        skin("a", { newUntil: days(5) }),
        skin("b", { newUntil: days(4) }),
        third,
      ];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([sale]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(
        cardKeys(modal.querySelector('[data-featured-section="new"]')!),
      ).toEqual(["pattern:a", "pattern:b"]);
      expect(
        cardKeys(modal.querySelector('[data-featured-section="sale"]')!),
      ).toEqual([third.key]);
    });

    it("lists a new item on sale that doesn't fit the New row under On sale", async () => {
      const sale = regularPromotion(hour());
      const oldest = skin("oldest", { ...discounted(sale), newUntil: days(2) });
      resolvedCatalog = [
        oldest,
        ...["a", "b", "c", "d"].map((name, i) =>
          skin(name, { newUntil: days(i + 3) }),
        ),
      ];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([sale]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(
        cardKeys(modal.querySelector('[data-featured-section="new"]')!),
      ).not.toContain(oldest.key);
      expect(
        cardKeys(modal.querySelector('[data-featured-section="sale"]')!),
      ).toEqual([oldest.key]);
    });

    it("opens Cosmetics → New from New's See all", async () => {
      resolvedCatalog = [skin("plain"), skin("fresh", { newUntil: days(3) })];
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      modal
        .querySelector<HTMLButtonElement>('[data-featured-see-all="new"]')!
        .click();
      await modal.updateComplete;
      expect(activeTab(modal)).toBe("cosmetics");
      expect(
        modal
          .querySelector('[data-store-subtab="new"]')
          ?.className.includes("text-aquarius"),
      ).toBe(true);
    });

    it("collapses On sale when a regular sale ends while open, then shows the empty line, without moving tab", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const endsAt = new Date(Date.now() + 60_000).toISOString();
      const sale = regularPromotion(endsAt);
      resolvedCatalog = [skin("cheap", discounted(sale))];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([sale]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(
        modal.querySelector('[data-featured-section="sale"]'),
      ).toBeTruthy();

      resolvedCatalog = [skin("cheap")];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([]));
      await vi.advanceTimersByTimeAsync(61_000);
      await vi.waitFor(() =>
        expect(modal.querySelector("[data-featured-empty]")).toBeTruthy(),
      );
      expect(activeTab(modal)).toBe("featured");
      expect(tabKeys(modal)).toContain("featured");
    });
  });

  describe("an owned deal", () => {
    const flash = flashPromotion(hour());
    const longName = "aurora_borealis_deluxe";
    beforeEach(() => {
      vi.mocked(fetchCosmetics).mockResolvedValue(
        catalog([flash], { [longName]: { name: longName, promotion: flash } }),
      );
    });

    async function openSignedIn(cached: Cosmetics | null = null) {
      vi.mocked(getCachedCosmetics).mockReturnValue(cached);
      const modal = await mountStore();
      internals(modal).userMeResponse = {
        player: {},
      } as unknown as UserMeResponse;
      modal.open();
      await settle(modal);
      return modal;
    }

    it("shows a strip with the item's full name and when the next deal comes", async () => {
      resolvedCatalog = [
        skin(longName, discounted(flash), "owned"),
        skin("fresh", { newUntil: days(3) }),
      ];
      const modal = await openSignedIn();
      const strip = modal.querySelector<HTMLElement>(
        '[data-featured-section="deal"][data-featured-deal-owned]',
      )!;
      expect(strip).toBeTruthy();
      expect(strip.textContent).toContain("store.featured_deal_owned");
      expect(strip.textContent).toContain("store.featured_next_deal_in");
      expect(strip.textContent).toContain("store.featured_next_deal_at");
      expect(strip.querySelector(".truncate")).toBeNull();
      expect(strip.querySelector("purchase-button")).toBeNull();
    });

    it("hides Featured when the strip would be all it shows", async () => {
      resolvedCatalog = [skin(longName, discounted(flash), "owned")];
      const cached = catalog([flash], {
        [longName]: { name: longName, promotion: flash },
      });
      const modal = await openSignedIn(cached);
      expect(tabKeys(modal)).not.toContain("featured");
      expect(activeTab(modal)).toBe("packs");
    });
  });

  describe("flash slot rollover", () => {
    const endsIn = 60_000;
    let flash: ReturnType<typeof flashPromotion>;

    async function openOnDeal() {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      flash = flashPromotion(new Date(Date.now() + endsIn).toISOString());
      resolvedCatalog = [
        skin("zap", discounted(flash)),
        skin("fresh", { newUntil: days(3) }),
      ];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([flash]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(
        modal.querySelector('[data-featured-section="deal"]'),
      ).toBeTruthy();
      return modal;
    }

    /** Ends the deal with the refetch held, and returns its resolver. */
    async function endDeal(modal: StoreModal) {
      let resolve: (c: Cosmetics | null) => void = () => {};
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics | null>((r) => (resolve = r)) as never,
      );
      await vi.advanceTimersByTimeAsync(endsIn + 1_000);
      await modal.updateComplete;
      return resolve;
    }

    it("holds the slot at its height until the next deal arrives", async () => {
      const modal = await openOnDeal();
      const resolve = await endDeal(modal);
      expect(internals(modal).dealRollover).toEqual({ height: 0 });
      const placeholder = modal.querySelector<HTMLElement>(
        "[data-featured-rollover]",
      )!;
      expect(placeholder).toBeTruthy();
      expect(placeholder.style.height).toBe("0px");
      expect(placeholder.textContent).toContain(
        "store.featured_next_deal_loading",
      );
      expect(activeTab(modal)).toBe("featured");

      const next = flashPromotion(hour(), "flash-2");
      resolvedCatalog = [
        skin("bolt", discounted(next)),
        skin("fresh", { newUntil: days(3) }),
      ];
      resolve(catalog([next]));
      await vi.waitFor(() =>
        expect(modal.querySelector("[data-featured-rollover]")).toBeNull(),
      );
      expect(internals(modal).dealRollover).toBeNull();
      expect(
        cardKeys(modal.querySelector('[data-featured-section="deal"]')!),
      ).toEqual(["pattern:bolt"]);
      expect(activeTab(modal)).toBe("featured");
    });

    it("uses the hero's minimum height when the slot wasn't on screen", async () => {
      const modal = await openOnDeal();
      modal.setActiveTab("packs");
      await modal.updateComplete;
      await endDeal(modal);
      expect(internals(modal).dealRollover).toEqual({ height: null });
      modal.setActiveTab("featured");
      await modal.updateComplete;
      const placeholder = modal.querySelector<HTMLElement>(
        "[data-featured-rollover]",
      )!;
      expect(placeholder.className).toContain("min-h-56");
      expect(placeholder.style.height).toBe("");
    });

    it("collapses the slot when the refetch runs out of retries", async () => {
      const modal = await openOnDeal();
      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      // The API keeps serving the ended sale.
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([flash]));
      await vi.advanceTimersByTimeAsync(endsIn + 1_000);
      expect(internals(modal).dealRollover).not.toBeNull();
      await vi.advanceTimersByTimeAsync(8 * 15_000 + 1_000);
      await vi.waitFor(() => expect(internals(modal).dealRollover).toBeNull());
      await modal.updateComplete;
      expect(modal.querySelector('[data-featured-section="deal"]')).toBeNull();
      expect(modal.querySelector('[data-featured-section="new"]')).toBeTruthy();
      expect(activeTab(modal)).toBe("featured");
    });

    it("collapses the slot when the next deal is one the player can neither buy nor own", async () => {
      const modal = await openOnDeal();
      const resolve = await endDeal(modal);
      expect(modal.querySelector("[data-featured-rollover]")).toBeTruthy();
      // The next flash item is affiliate-only: nothing on Featured shows it.
      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      resolve(catalog([flashPromotion(hour(), "flash-2")]));
      await vi.waitFor(() => expect(internals(modal).dealRollover).toBeNull());
      await modal.updateComplete;
      expect(modal.querySelector('[data-featured-section="deal"]')).toBeNull();
    });

    it("clears on a catalog with no flash sale, and on close", async () => {
      const modal = await openOnDeal();
      const resolve = await endDeal(modal);
      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      resolve(catalog([]));
      await vi.waitFor(() => expect(internals(modal).dealRollover).toBeNull());

      const again = await openOnDeal();
      await endDeal(again);
      expect(internals(again).dealRollover).not.toBeNull();
      again.close();
      expect(internals(again).dealRollover).toBeNull();
    });

    it("clears when the store is removed mid-rollover", async () => {
      const modal = await openOnDeal();
      await endDeal(modal);
      expect(internals(modal).dealRollover).not.toBeNull();
      expect(modal.querySelector("[data-featured-rollover]")).toBeTruthy();
      // The refetch is cancelled, so nothing else would clear it on reattach.
      modal.remove();
      expect(internals(modal).dealRollover).toBeNull();
      // Reattached, the placeholder drawn before the removal is gone too.
      document.body.appendChild(modal);
      await modal.updateComplete;
      expect(modal.querySelector("[data-featured-rollover]")).toBeNull();
    });
  });

  describe("a catalog the open will replace", () => {
    it("lands on Featured when a deal rolled over while the store was closed", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const dealA = flashPromotion(
        new Date(Date.now() + 60_000).toISOString(),
        "flash-a",
      );
      resolvedCatalog = [skin("zap", discounted(dealA))];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([dealA]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(activeTab(modal)).toBe("featured");
      modal.close();

      // Deal A ends and deal B starts while the store is closed. The store
      // still holds the catalog with A; the refetch brings B.
      await vi.advanceTimersByTimeAsync(61_000);
      const dealB = flashPromotion(hour(), "flash-b");
      vi.mocked(fetchCosmetics).mockImplementation(async () => {
        resolvedCatalog = [skin("bolt", discounted(dealB))];
        return catalog([dealB]);
      });
      modal.open();
      expect(tabKeys(modal)).toContain("featured");
      expect(activeTab(modal)).toBe("featured");
      await vi.waitFor(() =>
        expect(
          cardKeys(modal.querySelector('[data-featured-section="deal"]')!),
        ).toEqual(["pattern:bolt"]),
      );
    });

    it("prefers the shared cache, newer than the store's own copy", async () => {
      const modal = await mountStore();
      const ended = flashPromotion(new Date(Date.now() - 1_000).toISOString());
      internals(modal).cosmetics = catalog([ended]);
      const newer = catalog([]);
      vi.mocked(getCachedCosmetics).mockReturnValue(newer);
      vi.mocked(fetchCosmetics).mockResolvedValue(newer);
      modal.open();
      expect(internals(modal).cosmetics).toBe(newer);
    });

    it("shows Featured loading on a stale catalog, then what the refetch brings", async () => {
      vi.mocked(cosmeticsCacheIsStale).mockReturnValue(true);
      vi.mocked(refreshStaleCosmetics).mockReturnValue(true);
      vi.mocked(getCachedCosmetics).mockReturnValue(catalog([]));
      let resolve: (c: Cosmetics | null) => void = () => {};
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics | null>((r) => (resolve = r)) as never,
      );
      const modal = await mountStore();
      modal.open();
      await modal.updateComplete;
      expect(activeTab(modal)).toBe("featured");
      expect(modal.querySelector("[data-featured-loading]")).toBeTruthy();
      expect(modal.querySelector("[data-featured-empty]")).toBeNull();

      resolvedCatalog = [skin("fresh", { newUntil: days(3) })];
      resolve(catalog([]));
      await settle(modal);
      expect(
        cardKeys(modal.querySelector('[data-featured-section="new"]')!),
      ).toEqual(["pattern:fresh"]);
    });

    it("says nothing is featured once a stale catalog's refetch has nothing", async () => {
      vi.mocked(cosmeticsCacheIsStale).mockReturnValue(true);
      vi.mocked(refreshStaleCosmetics).mockReturnValue(true);
      vi.mocked(getCachedCosmetics).mockReturnValue(catalog([]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      expect(activeTab(modal)).toBe("featured");
      expect(modal.querySelector("[data-featured-empty]")).toBeTruthy();
    });
  });

  describe("a store removed while open", () => {
    it("runs no rollover or refetch when its deal ends", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const flash = flashPromotion(new Date(Date.now() + 60_000).toISOString());
      resolvedCatalog = [skin("zap", discounted(flash))];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([flash]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      const calls = vi.mocked(fetchCosmetics).mock.calls.length;
      modal.remove();
      await vi.advanceTimersByTimeAsync(61_000 + 8 * 15_000);
      expect(vi.mocked(fetchCosmetics).mock.calls.length).toBe(calls);
      expect(internals(modal).dealRollover).toBeNull();
    });
  });

  describe("affiliate mode", () => {
    it("shows no Featured tab and places cards as affiliate", async () => {
      const mine = skin("mine", {
        affiliateCode: "creator",
        newUntil: days(3),
      });
      resolvedCatalog = [mine, skin("fresh", { newUntil: days(3) })];
      const modal = await mountStore();
      modal.open({ affiliateCode: "creator" });
      await settle(modal);
      expect(internals(modal).modalConfig().tabs).toBeUndefined();
      expect(modal.querySelector("[data-featured-section]")).toBeNull();
      const product = modal.querySelector("[data-store-product]")!;
      expect(internals(modal).placementFor(product)).toEqual({
        kind: "affiliate",
      });
    });
  });

  describe("analytics placement", () => {
    it("places a purchase from the Featured hero as featured/deal", async () => {
      const flash = flashPromotion(hour());
      const deal = skin("zap", discounted(flash));
      resolvedCatalog = [deal, skin("fresh", { newUntil: days(3) })];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([flash]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      const button = modal.querySelector<PurchaseButton>(
        '[data-featured-section="deal"] [data-store-flash-buy] purchase-button',
      )!;
      button.requestCurrencyPurchase("hard");
      await button.updateComplete;
      button
        .querySelector("confirm-dialog")!
        .dispatchEvent(new CustomEvent("confirm"));
      await vi.waitFor(() =>
        expect(purchaseCosmetic).toHaveBeenCalledWith(
          deal,
          "hard",
          { kind: "featured", section: "deal" },
          // The price on the button: the server refuses to charge more.
          60,
        ),
      );
    });

    it("places each section's cards as featured/<section>, and nothing outside them", async () => {
      const flash = flashPromotion(hour());
      const sale = regularPromotion(hour());
      resolvedCatalog = [
        skin("zap", discounted(flash)),
        skin("fresh", { newUntil: days(3) }),
        skin("cheap", discounted(sale)),
      ];
      vi.mocked(fetchCosmetics).mockResolvedValue(catalog([flash, sale]));
      const modal = await mountStore();
      modal.open();
      await settle(modal);
      for (const section of ["deal", "new", "sale"]) {
        const product = modal.querySelector(
          `[data-featured-section="${section}"] [data-store-product]`,
        )!;
        expect(internals(modal).placementFor(product)).toEqual({
          kind: "featured",
          section,
        });
      }
      // On Featured, outside a section: no placement, never tab "featured".
      expect(internals(modal).placementFor(modal)).toBeUndefined();

      // The On sale tab's hero stays `flash`.
      modal
        .querySelector<HTMLButtonElement>('[data-featured-see-all="sale"]')!
        .click();
      await modal.updateComplete;
      const tabHero = modal.querySelector(
        "[data-store-flash] [data-store-product]",
      )!;
      expect(internals(modal).placementFor(tabHero)).toEqual({
        kind: "flash",
      });
    });
  });
});
