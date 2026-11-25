import type { Cosmetics, Effect } from "@openfront/shared/CosmeticSchemas";
import { nothing, type LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import type { CosmeticCard } from "../../src/client/components/CosmeticCard";
import type { CurrencyDisplay } from "../../src/client/components/CurrencyDisplay";
import type { EffectsGrid } from "../../src/client/components/EffectsGrid";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";
import {
  clockUntil,
  saleEndsIn,
} from "../../src/client/components/SaleCountdown";
import {
  fetchCosmetics,
  purchaseCosmetic,
  refreshStaleCosmetics,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";
import {
  COSMETICS_CHANGED,
  publishExperimentsForTest,
  resetExperimentsForTest,
} from "../../src/client/Experiments";
import { initNavigation } from "../../src/client/Navigation";
import { saleCoversEverything, type StoreModal } from "../../src/client/Store";
import type { StoreTracker } from "../../src/client/StoreTracking";
import {
  EFFECTS_KEY,
  PATTERN_KEY,
  UserSettings,
} from "../../src/client/UserSettings";
import { translateText } from "../../src/client/Utils";

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return { ...actual, translateText: vi.fn(actual.translateText) };
});

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(),
  purchaseCosmetic: vi.fn(),
  refreshStaleCosmetics: vi.fn(() => false),
  resolveCosmetics: vi.fn(),
}));

const pattern = {
  name: "stripes",
  pattern: "AAAAAA",
  product: null,
  priceHard: 120,
  rarity: "rare",
  affiliateCode: null,
} as const;

const red: ResolvedCosmetic = {
  type: "pattern",
  cosmetic: pattern as never,
  colorPalette: {
    name: "red",
    primaryColor: "#ef4444",
    secondaryColor: "#7f1d1d",
  },
  relationship: "purchasable",
  key: "pattern:stripes:red",
};

const blue: ResolvedCosmetic = {
  ...red,
  cosmetic: { ...pattern, priceHard: 240 } as never,
  colorPalette: {
    name: "blue",
    primaryColor: "#3b82f6",
    secondaryColor: "#1e3a8a",
  },
  key: "pattern:stripes:blue",
};

const green: ResolvedCosmetic = {
  ...red,
  colorPalette: {
    name: "green",
    primaryColor: "#22c55e",
    secondaryColor: "#14532d",
  },
  key: "pattern:stripes:green",
};

const flag: ResolvedCosmetic = {
  type: "flag",
  cosmetic: {
    name: "aurora",
    url: "/flags/aurora.svg",
    product: null,
    priceSoft: 500,
    rarity: "uncommon",
    affiliateCode: null,
  } as never,
  colorPalette: null,
  relationship: "purchasable",
  key: "flag:aurora",
};

function trail(name: string): ResolvedCosmetic {
  return {
    type: "effect",
    cosmetic: {
      name,
      product: null,
      priceHard: 80,
      rarity: "rare",
      affiliateCode: null,
      effectType: "transportShipTrail",
      attributes: {
        type: "gradient",
        colors: ["#ffffff"],
        colorSize: 1,
        movementSpeed: 1,
      },
    } as Effect,
    colorPalette: null,
    relationship: "purchasable",
    key: `effect:transportShipTrail:${name}`,
    effectType: "transportShipTrail",
  };
}

function explosion(name: string, nukeType: "atom" | "hydro") {
  return {
    type: "effect",
    cosmetic: {
      name,
      product: null,
      priceHard: 90,
      rarity: "epic",
      affiliateCode: null,
      effectType: "nukeExplosion",
      attributes: {
        type: "shockwave",
        nukeType,
        colors: ["#22d3ee"],
        size: 1,
        speed: 1,
        thickness: 1,
        transitionSpeed: 1,
      },
    } as Effect,
    colorPalette: null,
    relationship: "purchasable",
    key: `effect:nukeExplosion:${name}`,
    effectType: "nukeExplosion",
  } satisfies ResolvedCosmetic;
}

const wake = trail("wake");
const atom = explosion("atom_burst", "atom");
const hydro = explosion("hydro_burst", "hydro");
const hydroAlt = explosion("hydro_burst_alt", "hydro");

const pack: ResolvedCosmetic = {
  type: "pack",
  cosmetic: {
    name: "plutonium",
    displayName: "1,000 Plutonium",
    currency: "hard",
    amount: 1000,
    bonusAmount: 100,
    product: { productId: "pack", priceId: "pack-price", price: "$5" },
    rarity: "rare",
    affiliateCode: null,
  } as never,
  colorPalette: null,
  relationship: "purchasable",
  key: "pack:plutonium",
};

const goldSubscription: ResolvedCosmetic = {
  type: "subscription",
  cosmetic: {
    name: "gold",
    description: "Gold membership",
    priceMonthly: 5,
    dailySoftCurrency: 0,
    dailyHardCurrency: 10,
    hardCurrencySignupBonus: 100,
    unlimitedRanked: true,
    canCreatePublicLobbies: true,
    product: { productId: "gold", priceId: "gold-price", price: "$5" },
    rarity: "legendary",
    affiliateCode: null,
  } as never,
  colorPalette: null,
  relationship: "owned",
  key: "subscription:gold",
};

const platinumSubscription: ResolvedCosmetic = {
  ...goldSubscription,
  cosmetic: {
    ...(goldSubscription.cosmetic as object),
    name: "platinum",
    product: {
      productId: "platinum",
      priceId: "platinum-price",
      price: "$10",
    },
  } as never,
  relationship: "purchasable",
  key: "subscription:platinum",
};

const starterBundle: ResolvedCosmetic = {
  type: "cosmeticPack",
  cosmetic: {
    name: "starter",
    displayName: "Starter Pack",
    description: "",
    priceHard: 250,
    rarity: "epic",
    items: [
      { type: "pattern", name: "stripes", colorPalette: "red" },
      { type: "flag", name: "aurora" },
    ],
  },
  colorPalette: null,
  relationship: "purchasable",
  key: "cosmeticPack:starter",
  packItems: [red, flag],
};

const affiliatePattern: ResolvedCosmetic = {
  ...red,
  cosmetic: {
    ...pattern,
    affiliateCode: "creator",
  } as never,
  key: "pattern:affiliate:red",
};

let resolvedCatalog: ResolvedCosmetic[];
let store: StoreModal | undefined;

function card(modal: StoreModal, key: string): CosmeticCard | undefined {
  return [...modal.querySelectorAll<CosmeticCard>("cosmetic-card")].find(
    (candidate) =>
      candidate.resolved.key === key ||
      candidate.variants.some((variant) => variant.key === key),
  );
}

function product(modal: StoreModal, key: string): HTMLElement | undefined {
  return (
    card(modal, key)?.closest<HTMLElement>("[data-store-product]") ?? undefined
  );
}

function purchaseButton(modal: StoreModal, key: string): PurchaseButton {
  return product(modal, key)!.querySelector(
    "purchase-button",
  ) as PurchaseButton;
}

async function focusCard(modal: StoreModal, key: string) {
  const candidate = card(modal, key)!;
  candidate.onActivate!(
    candidate.variants.find((variant) => variant.key === key) ??
      candidate.resolved,
  );
  await modal.updateComplete;
}

async function activateVariant(modal: StoreModal, key: string) {
  const cosmeticCard = card(modal, key)!;
  const variant = cosmeticCard.variants.find(
    (candidate) => candidate.key === key,
  )!;
  cosmeticCard.onVariantActivate!(variant);
  await modal.updateComplete;
}

async function clickHardPurchase(modal: StoreModal) {
  const button = modal.querySelector("purchase-button") as PurchaseButton;
  button.requestCurrencyPurchase("hard");
  await button.updateComplete;
  button
    .querySelector("confirm-dialog")!
    .dispatchEvent(new CustomEvent("confirm"));
}

async function openStoreOnCosmetic(tab: "patterns" | "flags" | "crowns") {
  store = document.createElement("store-modal") as StoreModal;
  store.inline = true;
  document.body.appendChild(store);
  await store.updateComplete;
  store.open({ tab: "cosmetics" });
  await vi.waitFor(() =>
    expect(store!.querySelector("cosmetic-card")).toBeTruthy(),
  );

  if (tab !== "patterns") {
    const button = [
      ...store.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) => candidate.textContent?.trim() === `store.${tab}`)!;
    button.click();
    await store.updateComplete;
  }
  return store;
}

async function openEffectsStore() {
  store = document.createElement("store-modal") as StoreModal;
  store.inline = true;
  document.body.appendChild(store);
  await store.updateComplete;
  store.open({ tab: "effects" });
  await vi.waitFor(() =>
    expect(store!.querySelector("cosmetic-card")).toBeTruthy(),
  );
  const grid = store.querySelector("effects-grid") as EffectsGrid;
  await grid.updateComplete;
  return { store, grid };
}

async function openStoreOnTab(tab: "packs" | "subscriptions" | "bundles") {
  store = document.createElement("store-modal") as StoreModal;
  store.inline = true;
  document.body.appendChild(store);
  await store.updateComplete;
  store.open({ tab });
  await vi.waitFor(() =>
    expect(store!.querySelector("cosmetic-card")).toBeTruthy(),
  );
  return store;
}

describe("StoreModal cosmetic browser", () => {
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  beforeEach(() => {
    localStorage.clear();
    const settings = new UserSettings();
    settings.removeCached(PATTERN_KEY);
    settings.removeCached(EFFECTS_KEY);
    resolvedCatalog = [red, blue, green, flag, wake, atom, hydro, hydroAlt];
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue({} as Cosmetics);
    vi.mocked(resolveCosmetics).mockReset();
    vi.mocked(resolveCosmetics).mockImplementation(
      (_cosmetics, _userMeResponse, affiliateCode) =>
        affiliateCode
          ? resolvedCatalog.filter(
              (item) =>
                item.cosmetic !== null &&
                "affiliateCode" in item.cosmetic &&
                item.cosmetic.affiliateCode === affiliateCode,
            )
          : resolvedCatalog,
    );
    vi.mocked(purchaseCosmetic).mockReset();
    vi.mocked(purchaseCosmetic).mockResolvedValue(undefined);
  });

  afterEach(() => {
    store?.remove();
    store = undefined;
    localStorage.clear();
  });

  it("shows a running sale: banner, struck list price and discount", async () => {
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    vi.mocked(fetchCosmetics).mockResolvedValue({
      patterns: {},
      flags: {},
      promotions: [
        { id: "1", name: "Weekend Sale", percentOff: 25, endsAt },
        // Already over: the banner drops it even before the catalog refetches.
        {
          id: "2",
          name: "Old Sale",
          percentOff: 50,
          endsAt: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    } as unknown as Cosmetics);
    const promotion = { id: "1", name: "Weekend Sale", percentOff: 25, endsAt };
    resolvedCatalog = [
      {
        ...red,
        cosmetic: {
          ...pattern,
          priceHard: 90,
          listPriceHard: 120,
          promotion,
        } as never,
      },
    ];
    const modal = await openStoreOnCosmetic("patterns");
    await vi.waitFor(() =>
      expect(modal.querySelector("[data-store-sale-banner]")).toBeTruthy(),
    );

    const banner = modal.querySelector("[data-store-sale-banner]")!;
    expect(banner.children).toHaveLength(1);
    expect(banner.textContent).toContain("Weekend Sale");
    expect(banner.textContent).not.toContain("Old Sale");
    expect(banner.textContent).toContain("store.sale_ends_in_hours");
    expect(translateText).toHaveBeenCalledWith("store.sale_percent_off", {
      percent: 25,
    });
    const saleCard = card(modal, red.key)!;
    await saleCard.updateComplete;
    expect(saleCard.querySelector("[data-cosmetic-sale]")).toBeTruthy();
    const button = modal.querySelector<PurchaseButton>("purchase-button")!;
    expect(button.listPriceHard).toBe(120);
    await button.updateComplete;
    // The struck price, after its screen-reader "was" label.
    const struck = button.querySelector("s[data-sale-tag]")!;
    expect(struck.querySelector(".sr-only")?.textContent).toContain(
      "store.sale_was",
    );
    expect(struck.lastChild?.textContent?.trim()).toBe("120");
  });

  it("keeps the shown catalog when a stale refetch fails", async () => {
    const shown = { promotions: [] } as unknown as Cosmetics;
    vi.mocked(fetchCosmetics).mockResolvedValue(shown);
    const modal = await openStoreOnCosmetic("patterns");
    modal.close();

    vi.mocked(refreshStaleCosmetics).mockReturnValueOnce(true);
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue(null);
    modal.open({ tab: "cosmetics" });
    await vi.waitFor(() => expect(fetchCosmetics).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(shown);
    expect(modal.querySelector("cosmetic-card")).toBeTruthy();
  });

  it("keeps the shown catalog when the sign-in refetch fails", async () => {
    const shown = { promotions: [] } as unknown as Cosmetics;
    vi.mocked(fetchCosmetics).mockResolvedValue(shown);
    const modal = await openStoreOnCosmetic("patterns");

    vi.mocked(fetchCosmetics).mockResolvedValue(null);
    await modal.onUserMe(false);

    expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(shown);
    expect(modal.querySelector("cosmetic-card")).toBeTruthy();
  });

  it("keeps the newer catalog when an older fetch lands last", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const endsAt = new Date(Date.now() + 60_000).toISOString();
      vi.mocked(fetchCosmetics).mockResolvedValue({
        patterns: {},
        flags: {},
        promotions: [{ id: "1", name: "Sale", percentOff: 10, endsAt }],
      } as unknown as Cosmetics);
      const modal = await openStoreOnCosmetic("patterns");

      // A sign-in refetch starts, then the sale ends and a newer one starts.
      let resolveOlder: (c: Cosmetics) => void = () => {};
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics>((resolve) => {
          resolveOlder = resolve;
        }) as never,
      );
      const signIn = modal.onUserMe(false);
      const newer = { promotions: [] } as unknown as Cosmetics;
      vi.mocked(fetchCosmetics).mockResolvedValue(newer);
      await vi.advanceTimersByTimeAsync(61_000);
      await vi.waitFor(() =>
        expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
          newer,
        ),
      );

      resolveOlder({ promotions: [] } as unknown as Cosmetics);
      await signIn;
      expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
        newer,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches prices when a sale ends while the store is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const endsAt = new Date(Date.now() + 60_000).toISOString();
      vi.mocked(fetchCosmetics).mockResolvedValue({
        patterns: {},
        flags: {},
        promotions: [{ id: "1", name: "Flash", percentOff: 10, endsAt }],
      } as unknown as Cosmetics);
      resolvedCatalog = [
        {
          ...red,
          cosmetic: { ...pattern, priceHard: 108, listPriceHard: 120 } as never,
        },
      ];
      const modal = await openStoreOnCosmetic("patterns");
      await vi.waitFor(() =>
        expect(modal.querySelector("[data-store-sale-banner]")).toBeTruthy(),
      );
      expect(
        modal.querySelector<PurchaseButton>("purchase-button")!.listPriceHard,
      ).toBe(120);

      const after = { promotions: [] } as unknown as Cosmetics;
      vi.mocked(fetchCosmetics).mockClear();
      vi.mocked(fetchCosmetics).mockResolvedValue(after);
      resolvedCatalog = [red];
      await vi.advanceTimersByTimeAsync(61_000);

      await vi.waitFor(() => expect(fetchCosmetics).toHaveBeenCalled());
      await vi.waitFor(() =>
        expect(modal.querySelector("[data-store-sale-banner]")).toBeNull(),
      );
      expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
        after,
      );
      const button = modal.querySelector<PurchaseButton>("purchase-button")!;
      expect(button.priceHard).toBe(120);
      expect(button.listPriceHard).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a sale-end refetch that lands after the store was closed and reopened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const endsAt = new Date(Date.now() + 60_000).toISOString();
      const during = {
        patterns: {},
        flags: {},
        promotions: [{ id: "1", name: "Flash", percentOff: 10, endsAt }],
      } as unknown as Cosmetics;
      vi.mocked(fetchCosmetics).mockResolvedValue(during);
      const modal = await openStoreOnCosmetic("patterns");

      let resolveLate: (c: Cosmetics) => void = () => {};
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise<Cosmetics>((resolve) => {
          resolveLate = resolve;
        }) as never,
      );
      await vi.advanceTimersByTimeAsync(61_000);
      await vi.waitFor(() => expect(fetchCosmetics).toHaveBeenCalled());

      modal.close();
      const reopened = { promotions: [] } as unknown as Cosmetics;
      vi.mocked(refreshStaleCosmetics).mockReturnValueOnce(true);
      vi.mocked(fetchCosmetics).mockResolvedValue(reopened);
      modal.open({ tab: "cosmetics" });
      await vi.waitFor(() =>
        expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
          reopened,
        ),
      );

      resolveLate({ promotions: [] } as unknown as Cosmetics);
      await vi.advanceTimersByTimeAsync(0);
      expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
        reopened,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps refetching after a sale ends while the API still serves it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const sale = {
        id: "1",
        name: "Flash",
        percentOff: 10,
        endsAt: new Date(Date.now() + 60_000).toISOString(),
      };
      const during = {
        patterns: {},
        flags: {},
        promotions: [sale],
      } as unknown as Cosmetics;
      vi.mocked(fetchCosmetics).mockResolvedValue(during);
      const modal = await openStoreOnCosmetic("patterns");
      await vi.waitFor(() =>
        expect(modal.querySelector("[data-store-sale-banner]")).toBeTruthy(),
      );

      // The API's cached catalog still lists the sale just after it ends.
      const after = { promotions: [] } as unknown as Cosmetics;
      vi.mocked(fetchCosmetics).mockClear();
      vi.mocked(fetchCosmetics)
        .mockResolvedValueOnce(during)
        .mockResolvedValue(after);
      await vi.advanceTimersByTimeAsync(61_000);
      await vi.waitFor(() => expect(fetchCosmetics).toHaveBeenCalledTimes(1));
      expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
        during,
      );

      await vi.advanceTimersByTimeAsync(16_000);
      await vi.waitFor(() => expect(fetchCosmetics).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
          after,
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("still refetches when the store redraws after a sale ends, before its timer runs", async () => {
    const running = {
      patterns: {},
      flags: {},
      promotions: [
        {
          id: "1",
          name: "Flash",
          percentOff: 10,
          endsAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    } as unknown as Cosmetics;
    vi.mocked(fetchCosmetics).mockResolvedValue(running);
    const modal = await openStoreOnCosmetic("patterns");
    vi.useFakeTimers({ now: Date.now() });
    try {
      // Arms the sale-end timer on the fake clock.
      modal.requestUpdate();
      await modal.updateComplete;
      vi.setSystemTime(Date.now() + 61_000);
      modal.requestUpdate();
      await modal.updateComplete;
      vi.mocked(fetchCosmetics).mockClear();
      vi.mocked(fetchCosmetics).mockResolvedValue({
        promotions: [],
      } as unknown as Cosmetics);
      // Not the old timeout's minute: at once.
      vi.advanceTimersByTime(1);
      expect(fetchCosmetics).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches on reopen when the kept catalog still has an ended sale", async () => {
    const ended = {
      patterns: {},
      flags: {},
      promotions: [
        {
          id: "1",
          name: "Flash",
          percentOff: 10,
          endsAt: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    } as unknown as Cosmetics;
    vi.mocked(fetchCosmetics).mockResolvedValue(ended);
    const modal = await openStoreOnCosmetic("patterns");
    modal.close();

    const after = { promotions: [] } as unknown as Cosmetics;
    vi.mocked(fetchCosmetics).mockClear();
    vi.mocked(fetchCosmetics).mockResolvedValue(after);
    modal.open({ tab: "cosmetics" });

    await vi.waitFor(() =>
      expect((modal as unknown as { cosmetics: unknown }).cosmetics).toBe(
        after,
      ),
    );
    expect(fetchCosmetics).toHaveBeenCalled();
  });

  it("shows the list price once an item's sale has ended, whatever the catalog says", async () => {
    resolvedCatalog = [
      {
        ...red,
        cosmetic: {
          ...pattern,
          priceHard: 90,
          listPriceHard: 120,
          promotion: {
            id: "1",
            name: "Flash",
            percentOff: 25,
            endsAt: new Date(Date.now() - 1000).toISOString(),
          },
        } as never,
      },
    ];
    const modal = await openStoreOnCosmetic("patterns");
    const button = modal.querySelector<PurchaseButton>("purchase-button")!;
    await button.updateComplete;

    expect(button.priceHard).toBe(120);
    expect(button.listPriceHard).toBeNull();
    expect(button.querySelector("[data-sale-tag]")).toBeNull();
  });

  it("shows no banner or list price without a sale", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    expect(modal.querySelector("[data-store-sale-banner]")).toBeNull();
    const button = modal.querySelector<PurchaseButton>("purchase-button")!;
    await button.updateComplete;
    expect(button.listPriceHard).toBeNull();
    expect(button.querySelector("[data-sale-tag]")).toBeNull();
    expect(modal.querySelector("[data-cosmetic-sale]")).toBeNull();
  });

  it("lists discounted items first and under an On sale tab", async () => {
    const promotion = {
      id: "1",
      name: "Weekend Sale",
      percentOff: 25,
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const dots: ResolvedCosmetic = {
      ...red,
      cosmetic: {
        ...pattern,
        name: "dots",
        priceHard: 90,
        listPriceHard: 120,
        promotion,
      } as never,
      key: "pattern:dots:red",
    };
    const saleFlag: ResolvedCosmetic = {
      ...flag,
      cosmetic: {
        ...(flag.cosmetic as object),
        priceSoft: 400,
        listPriceSoft: 500,
        promotion,
      } as never,
    };
    resolvedCatalog = [red, blue, green, dots, saleFlag];
    const modal = await openStoreOnCosmetic("patterns");

    // On sale first, ahead of the catalog order.
    const keys = () =>
      [...modal.querySelectorAll<CosmeticCard>("cosmetic-card")].map(
        (c) => c.resolved.key,
      );
    expect(keys()).toEqual([dots.key, red.key]);

    const saleTab = modal.querySelector<HTMLButtonElement>(
      '[data-store-subtab="sale"]',
    )!;
    expect(saleTab.textContent).toContain("store.on_sale");
    saleTab.click();
    await modal.updateComplete;
    expect(keys()).toEqual([dots.key, saleFlag.key]);
  });

  // The home screen's sale banner links to #modal=store&tab=cosmetics&sub=sale.
  it("opens straight on the On sale tab with sub=sale", async () => {
    const promotion = {
      id: "1",
      name: "Weekend Sale",
      percentOff: 25,
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const dots: ResolvedCosmetic = {
      ...red,
      cosmetic: {
        ...pattern,
        name: "dots",
        priceHard: 90,
        listPriceHard: 120,
        promotion,
      } as never,
      key: "pattern:dots:red",
    };
    resolvedCatalog = [red, blue, dots];
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    store.open({ tab: "cosmetics", sub: "sale" });
    await vi.waitFor(() =>
      expect(store!.querySelector("cosmetic-card")).toBeTruthy(),
    );
    const keys = [...store.querySelectorAll<CosmeticCard>("cosmetic-card")].map(
      (c) => c.resolved.key,
    );
    expect(keys).toEqual([dots.key]);
  });

  it("leads On sale with the flash item, and its banner line opens it", async () => {
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    const flashSale = {
      id: "9",
      name: "Flash",
      percentOff: 50,
      endsAt,
      kind: "flash" as const,
    };
    vi.mocked(fetchCosmetics).mockResolvedValue({
      patterns: {},
      flags: {},
      promotions: [flashSale],
    } as unknown as Cosmetics);
    const zap: ResolvedCosmetic = {
      ...red,
      cosmetic: {
        ...pattern,
        name: "zap",
        priceHard: 60,
        listPriceHard: 120,
        promotion: flashSale,
      } as never,
      key: "pattern:zap:red",
    };
    resolvedCatalog = [red, blue, green, zap];
    const modal = await openStoreOnCosmetic("patterns");
    await vi.waitFor(() =>
      expect(modal.querySelector("[data-store-flash-banner]")).toBeTruthy(),
    );
    // On the Skins tab the flash item sorts first, with a ribboned card.
    expect(
      modal.querySelector<CosmeticCard>("cosmetic-card")!.resolved.key,
    ).toBe(zap.key);

    // The flash item glows and counts down; regular sale items don't.
    const flashCard = card(modal, zap.key)!;
    await flashCard.updateComplete;
    expect(
      flashCard.querySelector("[data-cosmetic-shell][data-cosmetic-flash]"),
    ).toBeTruthy();
    expect(flashCard.querySelector("[data-cosmetic-flash-ring]")).toBeTruthy();
    expect(
      flashCard.querySelector("[data-cosmetic-flash-timer] sale-countdown"),
    ).toBeTruthy();
    const plain = card(modal, red.key)!;
    expect(plain.querySelector("[data-cosmetic-flash]")).toBeNull();
    expect(plain.querySelector("[data-cosmetic-flash-timer]")).toBeNull();

    modal
      .querySelector<HTMLButtonElement>("[data-store-flash-banner]")!
      .click();
    await modal.updateComplete;
    const hero = modal.querySelector("[data-store-flash]")!;
    expect(hero).toBeTruthy();
    expect(
      hero.querySelector<CosmeticCard>("cosmetic-card")!.resolved.key,
    ).toBe(zap.key);
    expect(hero.querySelector("sale-countdown")).toBeTruthy();
    // One label for the one deadline, on the banner, the hero and the card:
    // when this deal ends, not when the next item starts.
    for (const el of [
      modal.querySelector("[data-store-flash-banner]")!,
      hero,
      hero.querySelector("[data-cosmetic-flash-timer]")!,
    ]) {
      expect(el.textContent).toContain("store.flash_ends_in");
    }
    expect(modal.textContent).not.toContain("store.flash_next_in");
    expect(modal.textContent).not.toContain("store.flash_left");
    // The price and the way to pay sit in the hero, beside the offer, at
    // full size; the hero's card carries no second buy button.
    const heroBuy = hero.querySelector<PurchaseButton>(
      "[data-store-flash-buy] purchase-button",
    )!;
    expect(heroBuy).toBeTruthy();
    expect(heroBuy.priceHard).toBe(
      (zap.cosmetic as { priceHard: number }).priceHard,
    );
    expect(hero.querySelector("cosmetic-card purchase-button")).toBeNull();
    expect(hero.querySelectorAll("purchase-button")).toHaveLength(1);
    // The flash item leads in the hero, not again in the grid below it.
    const gridKeys = [
      ...modal.querySelectorAll<CosmeticCard>(
        "[data-store-grid] cosmetic-card",
      ),
    ].map((c) => c.resolved.key);
    expect(gridKeys).not.toContain(zap.key);
  });

  it("lists a flash effect under On sale, with no empty-tab line under it", async () => {
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    const flashSale = {
      id: "9",
      name: "Flash",
      percentOff: 50,
      endsAt,
      kind: "flash" as const,
    };
    vi.mocked(fetchCosmetics).mockResolvedValue({
      patterns: {},
      flags: {},
      promotions: [flashSale],
    } as unknown as Cosmetics);
    const base = trail("comet");
    const comet: ResolvedCosmetic = {
      ...base,
      cosmetic: {
        ...(base.cosmetic as object),
        priceHard: 40,
        listPriceHard: 80,
        promotion: flashSale,
      } as never,
    };
    // The flash pick is an effect, which lives on the Effects tab, and it is
    // the only thing on sale.
    resolvedCatalog = [red, blue, comet];
    const modal = await openStoreOnCosmetic("patterns");
    await vi.waitFor(() =>
      expect(modal.querySelector("[data-store-flash-banner]")).toBeTruthy(),
    );

    modal
      .querySelector<HTMLButtonElement>("[data-store-flash-banner]")!
      .click();
    await modal.updateComplete;
    expect(modal.querySelector('[data-store-subtab="sale"]')).toBeTruthy();
    const hero = modal.querySelector("[data-store-flash]")!;
    expect(
      hero.querySelector<CosmeticCard>("cosmetic-card")!.resolved.key,
    ).toBe(comet.key);
    expect(modal.textContent).not.toContain("store.no_skins");
  });

  it("hides the On sale tab without a sale", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    expect(modal.querySelector('[data-store-subtab="sale"]')).toBeNull();
    expect(modal.querySelector('[data-store-subtab="patterns"]')).toBeTruthy();
  });

  describe("New tab", () => {
    const soon = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
    const later = () => new Date(Date.now() + 10 * 86_400_000).toISOString();
    const withNew = (
      resolved: ResolvedCosmetic,
      newUntil: string,
      key = resolved.key,
    ): ResolvedCosmetic => ({
      ...resolved,
      cosmetic: { ...(resolved.cosmetic as object), newUntil } as never,
      key,
    });
    const keys = (modal: StoreModal) =>
      [...modal.querySelectorAll<CosmeticCard>("cosmetic-card")].map(
        (c) => c.resolved.key,
      );

    it("lists new cosmetics, effects and bundles, newest first", async () => {
      const newFlag = withNew(flag, soon());
      const newTrail = withNew(trail("comet"), later());
      const newBundle = withNew(starterBundle, soon());
      resolvedCatalog = [red, blue, newFlag, newTrail, newBundle];
      const modal = await openStoreOnCosmetic("patterns");

      const newTab = modal.querySelector<HTMLButtonElement>(
        '[data-store-subtab="new"]',
      )!;
      expect(newTab.textContent).toContain("store.new_tab");
      // New comes first in the sub-tab bar.
      expect(
        modal
          .querySelector("[data-store-subtab]")!
          .getAttribute("data-store-subtab"),
      ).toBe("new");
      newTab.click();
      await modal.updateComplete;
      expect(keys(modal)[0]).toBe(newTrail.key);
      expect(new Set(keys(modal))).toEqual(
        new Set([newTrail.key, newFlag.key, newBundle.key]),
      );
      expect(
        (
          modal as unknown as { placementFor(el: Element): unknown }
        ).placementFor(product(modal, newFlag.key)!),
      ).toEqual({
        kind: "tab",
        tab: "cosmetics",
        subTab: "new",
      });
    });

    it("hides the New tab when nothing is new", async () => {
      resolvedCatalog = [
        red,
        withNew(flag, new Date(Date.now() - 1000).toISOString()),
      ];
      const modal = await openStoreOnCosmetic("patterns");
      expect(modal.querySelector('[data-store-subtab="new"]')).toBeNull();
    });

    it("leaves out a new item the player already owns", async () => {
      resolvedCatalog = [
        { ...withNew(flag, soon()), relationship: "owned" },
        withNew(red, soon(), "pattern:fresh:red"),
      ];
      const modal = await openStoreOnCosmetic("patterns");
      modal
        .querySelector<HTMLButtonElement>('[data-store-subtab="new"]')!
        .click();
      await modal.updateComplete;
      expect(keys(modal)).toEqual(["pattern:fresh:red"]);
    });

    it("drops the badges, and the New tab, when the items stop being new", async () => {
      const until = new Date(Date.now() + 60_000).toISOString();
      const fresh = withNew(red, until, "pattern:fresh:red");
      (fresh.cosmetic as { name: string }).name = "fresh";
      resolvedCatalog = [red, fresh, withNew(flag, until)];
      const modal = await openStoreOnCosmetic("patterns");
      modal
        .querySelector<HTMLButtonElement>('[data-store-subtab="new"]')!
        .click();
      await modal.updateComplete;
      expect(new Set(keys(modal))).toEqual(new Set([flag.key, fresh.key]));
      expect(modal.querySelectorAll("[data-cosmetic-new]")).toHaveLength(2);

      vi.useFakeTimers({ now: Date.now() });
      try {
        // Drop the real timer; the redraw re-arms it on the fake clock.
        (modal as unknown as { clearNewEnd(): void }).clearNewEnd();
        modal.requestUpdate();
        await modal.updateComplete;
        vi.advanceTimersByTime(61_000);
        await modal.updateComplete;
        expect(modal.querySelector('[data-store-subtab="new"]')).toBeNull();
        expect(keys(modal)).toEqual([red.key, fresh.key]);
        await Promise.all(
          [...modal.querySelectorAll<CosmeticCard>("cosmetic-card")].map(
            (c) => c.updateComplete,
          ),
        );
        expect(modal.querySelector("[data-cosmetic-new]")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("opens straight on the New tab with sub=new", async () => {
      const newFlag = withNew(flag, soon());
      resolvedCatalog = [red, newFlag];
      store = document.createElement("store-modal") as StoreModal;
      store.inline = true;
      document.body.appendChild(store);
      await store.updateComplete;
      store.open({ tab: "cosmetics", sub: "new" });
      await vi.waitFor(() =>
        expect(store!.querySelector("cosmetic-card")).toBeTruthy(),
      );
      expect(keys(store)).toEqual([newFlag.key]);
    });

    it("keeps sub=new while the catalog is still loading", async () => {
      const newFlag = withNew(flag, soon());
      resolvedCatalog = [red, newFlag];
      // Like the real resolver: no catalog yet, nothing to list.
      vi.mocked(resolveCosmetics).mockImplementation((cosmetics) =>
        cosmetics === null ? [] : resolvedCatalog,
      );
      let deliver!: (catalog: Cosmetics) => void;
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise((resolve) => (deliver = resolve)),
      );
      store = document.createElement("store-modal") as StoreModal;
      store.inline = true;
      document.body.appendChild(store);
      await store.updateComplete;
      store.open({ tab: "cosmetics", sub: "new" });
      await store.updateComplete;
      deliver({} as Cosmetics);
      await vi.waitFor(() =>
        expect(store!.querySelector("cosmetic-card")).toBeTruthy(),
      );
      expect(keys(store)).toEqual([newFlag.key]);
    });

    it("shows a bundle's contents from the New tab", async () => {
      const newBundle = withNew(starterBundle, soon());
      resolvedCatalog = [red, newBundle];
      const modal = await openStoreOnCosmetic("patterns");
      modal
        .querySelector<HTMLButtonElement>('[data-store-subtab="new"]')!
        .click();
      await modal.updateComplete;
      card(modal, newBundle.key)!.onActivate!(newBundle);
      await modal.updateComplete;
      expect(modal.querySelector("pack-contents-dialog")).toBeTruthy();
    });

    /** Opens the New tab on one flag that stops being new in a minute. */
    async function openNewTabExpiringSoon() {
      const until = new Date(Date.now() + 60_000).toISOString();
      resolvedCatalog = [red, withNew(flag, until)];
      const modal = await openStoreOnCosmetic("patterns");
      modal
        .querySelector<HTMLButtonElement>('[data-store-subtab="new"]')!
        .click();
      await modal.updateComplete;
      expect(keys(modal)).toEqual([flag.key]);
      return modal;
    }
    const newEndTimer = (modal: StoreModal) =>
      (modal as unknown as { newEndTimer: unknown }).newEndTimer;

    it("drops expired items at once when the clock passes the deadline before the timer fires", async () => {
      const modal = await openNewTabExpiringSoon();
      vi.useFakeTimers({ now: Date.now() });
      try {
        // Arms the timer on the fake clock, a minute out.
        modal.requestUpdate();
        await modal.updateComplete;
        // The clock jumps past the deadline; the timer is still a minute
        // away when a redraw comes in.
        vi.setSystemTime(Date.now() + 61_000);
        modal.requestUpdate();
        await modal.updateComplete;
        vi.advanceTimersByTime(1);
        await modal.updateComplete;
        expect(modal.querySelector('[data-store-subtab="new"]')).toBeNull();
        expect(keys(modal)).toEqual([red.key]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("drops expired items on a redraw with no timer armed", async () => {
      const modal = await openNewTabExpiringSoon();
      vi.useFakeTimers({ now: Date.now() });
      try {
        (modal as unknown as { clearNewEnd(): void }).clearNewEnd();
        vi.setSystemTime(Date.now() + 61_000);
        modal.requestUpdate();
        await modal.updateComplete;
        vi.advanceTimersByTime(1);
        await modal.updateComplete;
        expect(keys(modal)).toEqual([red.key]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears the New timer when the store is removed while open", async () => {
      const modal = await openNewTabExpiringSoon();
      modal.requestUpdate();
      await modal.updateComplete;
      const armed = newEndTimer(modal);
      expect(armed).not.toBeNull();
      const clear = vi.spyOn(globalThis, "clearTimeout");
      try {
        modal.remove();
        expect(clear).toHaveBeenCalledWith(armed);
      } finally {
        clear.mockRestore();
      }
      expect(newEndTimer(modal)).toBeNull();
    });

    it("leaves the Effects tab's selection alone when an effect stops being new", async () => {
      const until = new Date(Date.now() + 60_000).toISOString();
      resolvedCatalog = [red, withNew(trail("comet"), until), atom];
      const { store: modal } = await openEffectsStore();
      vi.useFakeTimers({ now: Date.now() });
      try {
        // Drop the real timer; the redraw re-arms it on the fake clock.
        (modal as unknown as { clearNewEnd(): void }).clearNewEnd();
        modal.requestUpdate();
        await modal.updateComplete;
        const select = vi.spyOn(
          modal as unknown as { selectVisible(groups: unknown): void },
          "selectVisible",
        );
        const cardsDone = () =>
          Promise.all(
            [...modal.querySelectorAll<CosmeticCard>("cosmetic-card")].map(
              (c) => c.updateComplete,
            ),
          );
        await cardsDone();
        expect(modal.querySelector("[data-cosmetic-new]")).toBeTruthy();
        vi.advanceTimersByTime(61_000);
        await modal.updateComplete;
        await cardsDone();
        expect(modal.querySelector("[data-cosmetic-new]")).toBeNull();
        expect(select).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("falls back to Skins when the latest fetch finds nothing new, even with an older one pending", async () => {
      const modal = await openStoreOnCosmetic("patterns");
      modal.close();
      // A sale-end refetch from before still hangs…
      vi.mocked(fetchCosmetics).mockReturnValueOnce(new Promise(() => {}));
      void (
        modal as unknown as { loadCatalog(): Promise<unknown> }
      ).loadCatalog();
      // …and the reopen's own fetch finds nothing new.
      vi.mocked(refreshStaleCosmetics).mockReturnValueOnce(true);
      vi.mocked(fetchCosmetics).mockResolvedValueOnce({} as Cosmetics);
      modal.open({ tab: "cosmetics", sub: "new" });
      await vi.waitFor(() =>
        expect(
          modal
            .querySelector("[data-store-subtab].border-malibu-blue")
            ?.getAttribute("data-store-subtab"),
        ).toBe("patterns"),
      );
      await vi.waitFor(() => expect(keys(modal)[0]).toBe(red.key));
    });

    it("keeps sub=new while a stale catalog refreshes", async () => {
      // The cached catalog has nothing new; the refreshed one does.
      const cached = {} as Cosmetics;
      const refreshed = {} as Cosmetics;
      const newFlag = withNew(flag, soon());
      vi.mocked(resolveCosmetics).mockImplementation((cosmetics) =>
        cosmetics === refreshed ? [red, newFlag] : [red],
      );
      vi.mocked(fetchCosmetics).mockResolvedValueOnce(cached);
      const modal = await openStoreOnCosmetic("patterns");
      modal.close();

      vi.mocked(refreshStaleCosmetics).mockReturnValueOnce(true);
      let deliver!: (catalog: Cosmetics) => void;
      vi.mocked(fetchCosmetics).mockReturnValueOnce(
        new Promise((resolve) => (deliver = resolve)),
      );
      modal.open({ tab: "cosmetics", sub: "new" });
      await modal.updateComplete;
      // While it waits, the bar still shows New as the selected tab, and the
      // empty grid says nothing is new rather than "No skins".
      expect(
        modal
          .querySelector("[data-store-subtab].border-malibu-blue")
          ?.getAttribute("data-store-subtab"),
      ).toBe("new");
      expect(modal.textContent).toContain("store.no_new_items");
      expect(modal.textContent).not.toContain("store.no_skins");
      deliver(refreshed);
      await vi.waitFor(() => expect(keys(modal)).toEqual([newFlag.key]));
    });

    it("keeps its New timer, and its resolved catalog, across redraws", async () => {
      const modal = await openNewTabExpiringSoon();
      modal.requestUpdate();
      await modal.updateComplete;
      const armed = newEndTimer(modal);
      expect(armed).not.toBeNull();
      vi.mocked(resolveCosmetics).mockClear();
      modal.requestUpdate();
      await modal.updateComplete;
      modal.requestUpdate();
      await modal.updateComplete;
      expect(newEndTimer(modal)).toBe(armed);
      expect(resolveCosmetics).not.toHaveBeenCalled();
    });
  });

  it("tells a store-wide sale from one on selected items", () => {
    const promotion = { id: "s", name: "Sale", percentOff: 20, endsAt: "" };
    const catalog = (secondOnSale: boolean) =>
      ({
        patterns: {
          a: { priceHard: 80, listPriceHard: 100, promotion },
        },
        flags: {
          b: secondOnSale
            ? { priceSoft: 400, listPriceSoft: 500, promotion }
            : { priceSoft: 500 },
          // Not for sale: doesn't count either way.
          c: {},
        },
      }) as unknown as Cosmetics;
    expect(saleCoversEverything(catalog(true), "s")).toBe(true);
    expect(saleCoversEverything(catalog(false), "s")).toBe(false);
    expect(saleCoversEverything(null, "s")).toBe(false);
  });

  it("shows a flash sale's clock with seconds", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    const at = (s: number) => new Date(now + s * 1000).toISOString();
    expect(clockUntil(at(3600 + 23 * 60 + 45), now)).toBe("1:23:45");
    expect(clockUntil(at(9 * 60 + 5), now)).toBe("9:05");
    expect(clockUntil(at(-5), now)).toBe("0:00");
  });

  it("counts a sale's end down in days, hours or minutes", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    const at = (ms: number) => new Date(now + ms).toISOString();
    vi.mocked(translateText).mockClear();
    saleEndsIn(at((2 * 24 + 5) * 3_600_000), now);
    saleEndsIn(at(3 * 3_600_000 + 12 * 60_000), now);
    saleEndsIn(at(7 * 60_000 + 30_000), now);
    expect(vi.mocked(translateText).mock.calls).toEqual([
      ["store.sale_ends_in_days", { days: 2, hours: 5 }],
      ["store.sale_ends_in_hours", { hours: 3, minutes: 12 }],
      ["store.sale_ends_in_minutes", { minutes: 8 }],
    ]);
  });

  it("selects the first visible item and purchases the selected variant", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    expect(card(modal, red.key)?.activeVariantKey).toBe(red.key);

    await focusCard(modal, blue.key);
    await activateVariant(modal, blue.key);
    await clickHardPurchase(modal);

    await vi.waitFor(() =>
      expect(purchaseCosmetic).toHaveBeenCalledWith(
        blue,
        "hard",
        expect.objectContaining({ kind: "tab", tab: "cosmetics" }),
        240,
      ),
    );
    expect(localStorage.getItem(PATTERN_KEY)).toBeNull();
  });

  it("still purchases, without a placement, when resolving it throws", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    vi.spyOn(
      modal as unknown as { placementFor(el: Element): unknown },
      "placementFor",
    ).mockImplementation(() => {
      throw new Error("boom");
    });

    await focusCard(modal, blue.key);
    await activateVariant(modal, blue.key);
    await clickHardPurchase(modal);

    await vi.waitFor(() =>
      expect(purchaseCosmetic).toHaveBeenCalledWith(
        blue,
        "hard",
        undefined,
        240,
      ),
    );
  });

  it("confirms the exact variant and price that initiated checkout", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    const initialPurchaseButton = purchaseButton(modal, red.key);
    expect(initialPurchaseButton.priceHard).toBe(120);
    initialPurchaseButton.requestCurrencyPurchase("hard");
    await initialPurchaseButton.updateComplete;

    await activateVariant(modal, blue.key);
    const pendingButton = purchaseButton(modal, blue.key);
    pendingButton
      .querySelector("confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));

    await vi.waitFor(() =>
      expect(purchaseCosmetic).toHaveBeenCalledWith(
        red,
        "hard",
        expect.any(Object),
        120,
      ),
    );
    expect(
      (
        vi.mocked(purchaseCosmetic).mock.calls[0]![0].cosmetic as {
          priceHard: number;
        }
      ).priceHard,
    ).toBe(120);
    expect(purchaseCosmetic).not.toHaveBeenCalledWith(
      blue,
      "hard",
      expect.anything(),
    );
    expect(purchaseCosmetic).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PATTERN_KEY)).toBeNull();
  });

  it("names the colour in the purchase confirmation", async () => {
    const translations = {
      "inventory.selected_cosmetic_variant": "{name} ({variant})",
      "territory_patterns.pattern.stripes": "Ocean Stripes",
      "territory_patterns.color_palette.red": "Crimson",
    };
    const languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
    try {
      const modal = await openStoreOnCosmetic("patterns");
      // Every palette of a pattern shares one name, so the confirmation has to
      // say which colour is about to be charged for.
      expect(purchaseButton(modal, red.key).itemName).toBe(
        "Ocean Stripes (Crimson)",
      );
    } finally {
      languageFixture.remove();
    }
  });

  it("keeps inspection separate from the equipped green state", async () => {
    localStorage.setItem(PATTERN_KEY, green.key);
    const modal = await openStoreOnCosmetic("patterns");

    await activateVariant(modal, blue.key);

    expect(card(modal, blue.key)?.state).toBe("focused");
    expect(card(modal, blue.key)?.activeVariantKey).toBe(blue.key);
    expect(modal.querySelector('[data-cosmetic-state="equipped"]')).toBeNull();
    expect(localStorage.getItem(PATTERN_KEY)).toBe(green.key);
  });

  it("retains a still-visible inspected item when the catalog changes", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    await activateVariant(modal, blue.key);
    resolvedCatalog = [green, blue, flag, wake, atom, hydro];

    await modal.onUserMe(false);
    await modal.updateComplete;

    expect(card(modal, blue.key)?.activeVariantKey).toBe(blue.key);
  });

  it("falls back to the first visible group when inspection becomes invisible", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    await activateVariant(modal, blue.key);

    const flagsTab = [
      ...modal.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) => candidate.textContent?.trim() === "store.flags")!;
    flagsTab.click();
    await modal.updateComplete;

    expect(card(modal, flag.key)?.state).toBe("focused");
  });

  it("hides the Card sub-tab when only held-back taunts and titles are sold", async () => {
    const item = { product: null, rarity: "rare" };
    const heldBackOnly = {
      patterns: {},
      flags: {},
      cardTitles: {
        veteran: { ...item, name: "veteran", text: "Veteran", priceSoft: 500 },
      },
      taunts: {
        salute: {
          ...item,
          name: "salute",
          tauntKind: "icon",
          preset: "salute",
          priceSoft: 800,
        },
      },
    };
    vi.mocked(fetchCosmetics).mockResolvedValue(
      heldBackOnly as unknown as Cosmetics,
    );
    const modal = await openStoreOnCosmetic("patterns");
    expect(modal.querySelector("[data-store-subtab='card']")).toBeNull();

    store?.remove();
    vi.mocked(fetchCosmetics).mockResolvedValue({
      ...heldBackOnly,
      cardBackgrounds: {
        bg_frontline: {
          ...item,
          name: "bg_frontline",
          url: "/bg.webp",
          priceHard: 240,
        },
      },
    } as unknown as Cosmetics);
    const withBackground = await openStoreOnCosmetic("patterns");
    await vi.waitFor(() =>
      expect(
        withBackground.querySelector("[data-store-subtab='card']"),
      ).not.toBeNull(),
    );
  });

  it("styles cosmetic sub-tabs like the modal's own tab bar", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    const subTab = [
      ...modal.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) => candidate.textContent?.trim() === "store.crowns")!;

    // Same typography as the o-modal tab bar (px-4 py-3 text-sm font-bold),
    // so the nested bar does not read as heavier or taller than its parent.
    for (const token of [
      "px-4",
      "py-3",
      "text-sm",
      "font-bold",
      "uppercase",
      "tracking-wider",
      "whitespace-nowrap",
    ]) {
      expect(subTab.classList.contains(token)).toBe(true);
    }
    expect(subTab.classList.contains("font-black")).toBe(false);
  });

  it("clears product tiles for an empty cosmetic category", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    const crownsTab = [
      ...modal.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) => candidate.textContent?.trim() === "store.crowns")!;

    crownsTab.click();
    await modal.updateComplete;

    expect(modal.querySelector("[data-store-product]")).toBeNull();
    expect(modal.querySelector("purchase-button")).toBeNull();
  });

  it("focuses effect and nuke-subtype purchases without changing effect settings", async () => {
    const { store: modal, grid } = await openEffectsStore();
    expect(grid.parentElement?.hasAttribute("data-store-browser")).toBe(false);
    expect(card(modal, wake.key)?.state).toBe("focused");

    const wakeCard = card(modal, wake.key)!;
    wakeCard.onActivate!(wakeCard.resolved);
    await modal.updateComplete;

    grid
      .querySelectorAll<HTMLButtonElement>("button[class*='-mb-px']")[2]!
      .click();
    await grid.updateComplete;
    grid
      .querySelectorAll<HTMLButtonElement>("button[class*='rounded-full']")[1]!
      .click();
    await grid.updateComplete;

    const hydroCard = card(modal, hydro.key)!;
    hydroCard.onActivate!(hydroCard.resolved);
    await modal.updateComplete;

    expect(hydroCard.state).toBe("focused");
    await purchaseButton(modal, hydro.key).onPurchaseHard!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      hydro,
      "hard",
      expect.any(Object),
      90,
    );
    expect(localStorage.getItem(EFFECTS_KEY)).toBeNull();
  });

  it("opens the in-game preview when an effect card is activated", async () => {
    const { store: modal } = await openEffectsStore();
    expect(modal.querySelector("cosmetic-preview-modal")).toBeNull();

    const wakeCard = card(modal, wake.key)!;
    wakeCard.onActivate!(wakeCard.resolved);
    await modal.updateComplete;

    expect(modal.querySelector("cosmetic-preview-modal")).toBeTruthy();
  });

  it("reconciles inspected effects immediately when subtype tabs change", async () => {
    const { store: modal, grid } = await openEffectsStore();
    expect(card(modal, wake.key)?.state).toBe("focused");

    grid
      .querySelectorAll<HTMLButtonElement>("button[class*='-mb-px']")[2]!
      .click();
    await grid.updateComplete;
    await modal.updateComplete;
    expect(card(modal, atom.key)?.state).toBe("focused");

    const nukeTabs = () =>
      grid.querySelectorAll<HTMLButtonElement>("button[class*='rounded-full']");
    nukeTabs()[1]!.click();
    await grid.updateComplete;
    await modal.updateComplete;
    expect(card(modal, hydro.key)?.state).toBe("focused");

    const alternate = card(modal, hydroAlt.key)!;
    alternate.onActivate!(alternate.resolved);
    await modal.updateComplete;
    nukeTabs()[1]!.click();
    await grid.updateComplete;
    await modal.updateComplete;
    expect(card(modal, hydroAlt.key)?.state).toBe("focused");

    nukeTabs()[2]!.click();
    await grid.updateComplete;
    await modal.updateComplete;
    expect(grid.querySelector("[data-store-product]")).toBeNull();
    expect(grid.querySelector("purchase-button")).toBeNull();
  });

  it("drops an open preview when the store closes", async () => {
    const { store: modal } = await openEffectsStore();
    const wakeCard = card(modal, wake.key)!;
    wakeCard.onActivate!(wakeCard.resolved);
    await modal.updateComplete;
    expect(modal.querySelector("cosmetic-preview-modal")).toBeTruthy();

    modal.close();
    await modal.updateComplete;
    expect(modal.querySelector("cosmetic-preview-modal")).toBeNull();
  });

  it("previews an uncolored pattern with its catalog colors, not the palette placeholder", async () => {
    const base: ResolvedCosmetic = {
      ...red,
      colorPalette: null,
      key: "pattern:stripes",
    };
    resolvedCatalog = [base, red];
    const modal = await openStoreOnCosmetic("patterns");
    // Both are variants of one card; activate the exact variant.
    const canvas = async (variant: ResolvedCosmetic) => {
      card(modal, variant.key)!.onActivate!(variant);
      await modal.updateComplete;
      const preview = modal.querySelector(
        "cosmetic-preview-modal",
      ) as LitElement;
      await preview.updateComplete;
      return preview.querySelector("cosmetic-render-canvas") as unknown as {
        customColors: string[] | null;
      };
    };

    expect((await canvas(red)).customColors).toEqual(["#ef4444", "#7f1d1d"]);
    modal
      .querySelector("cosmetic-preview-modal")!
      .dispatchEvent(new CustomEvent("close-preview"));
    await modal.updateComplete;
    expect((await canvas(base)).customColors).toBeNull();
  });

  it("previews a bundle item from the contents dialog, then restores the dialog", async () => {
    resolvedCatalog = [starterBundle];
    const modal = await openStoreOnTab("bundles");
    card(modal, starterBundle.key)!.onActivate!(starterBundle);
    await modal.updateComplete;
    await (modal.querySelector("pack-contents-dialog") as LitElement)
      .updateComplete;

    const dialog = () =>
      document.body.querySelector<HTMLElement>("[data-pack-contents]");
    const items = [
      ...dialog()!.querySelectorAll<CosmeticCard>(
        "[data-pack-contents-item] cosmetic-card",
      ),
    ];
    await Promise.all(items.map((item) => item.updateComplete));
    // Items are store cards without a price. Only the skin can be rendered
    // in-game; the flag gets no eye and activating it opens nothing.
    expect(items[0].actionContent).toBe(nothing);
    const bubbles = items.map((item) =>
      item.querySelector<HTMLElement>("[data-cosmetic-preview-bubble]"),
    );
    expect(bubbles[0]).toBeTruthy();
    expect(bubbles[1]).toBeNull();
    items[1].onActivate!(items[1].resolved);
    await modal.updateComplete;
    expect(modal.querySelector("cosmetic-preview-modal")).toBeNull();

    // Clicking the card (its image) previews, like everywhere else...
    items[0].onActivate!(items[0].resolved);
    await modal.updateComplete;
    const preview = modal.querySelector("cosmetic-preview-modal")!;
    expect(preview).toBeTruthy();
    expect(preview.querySelector("purchase-button")).toBeNull();
    expect(dialog()).toBeNull();
    preview.dispatchEvent(new CustomEvent("close-preview"));
    await modal.updateComplete;
    await (modal.querySelector("pack-contents-dialog") as LitElement)
      .updateComplete;

    // ...and so does the eye.
    const reopened = dialog()!.querySelector<CosmeticCard>("cosmetic-card")!;
    await reopened.updateComplete;
    reopened
      .querySelector<HTMLElement>("[data-cosmetic-preview-bubble] button")!
      .click();
    await modal.updateComplete;
    expect(modal.querySelector("cosmetic-preview-modal")).toBeTruthy();
    expect(dialog()).toBeNull();

    modal
      .querySelector("cosmetic-preview-modal")!
      .dispatchEvent(new CustomEvent("close-preview"));
    await modal.updateComplete;
    expect(modal.querySelector("cosmetic-preview-modal")).toBeNull();
    await (modal.querySelector("pack-contents-dialog") as LitElement)
      .updateComplete;
    expect(dialog()).toBeTruthy();
  });

  it("uses the browser shell and exact resolved pack purchase", async () => {
    resolvedCatalog = [pack];
    const modal = await openStoreOnTab("packs");

    expect(modal.querySelector("[data-store-browser]")).toBeTruthy();
    expect(modal.querySelector("[data-store-grid]")).toBeTruthy();
    expect(modal.querySelector("[data-store-grid] custom-currency-card")).toBe(
      modal.querySelector("custom-currency-card"),
    );
    expect(modal.querySelector("[data-store-grid]")?.className).toMatch(
      /flex-wrap/,
    );
    for (const el of [
      card(modal, pack.key),
      modal.querySelector("custom-currency-card"),
    ]) {
      // Half-width (minus the gap) below sm so phones fit two per row, as the
      // cosmetics and effects grids already do; a fixed w-48 from sm up.
      expect(el?.className).toContain("w-[calc(50%-0.5rem)]");
      expect(el?.className).toContain("sm:w-48");
      expect(el?.className).not.toMatch(/h-full/);
    }
    expect(card(modal, pack.key)?.state).toBe("focused");
    expect(purchaseButton(modal, pack.key).closest("cosmetic-card")).toBe(
      card(modal, pack.key),
    );

    await purchaseButton(modal, pack.key).onPurchaseDollar!();

    expect(purchaseCosmetic).toHaveBeenCalledWith(
      pack,
      "dollar",
      expect.any(Object),
      undefined,
    );
  });

  it("keeps each currency on its own line across mixed-payment cards", async () => {
    const hardPack: ResolvedCosmetic = {
      ...pack,
      cosmetic: {
        ...(pack.cosmetic as object),
        name: "hard-only",
        displayName: "500 Plutonium",
        product: null,
        priceHard: 500,
      } as never,
      key: "pack:hard-only",
    };
    resolvedCatalog = [pack, hardPack];
    const modal = await openStoreOnTab("packs");

    const lines = (key: string) =>
      [
        ...purchaseButton(modal, key).querySelectorAll(
          ".flex.flex-col > button, .flex.flex-col > span",
        ),
      ].map((el) =>
        el.tagName === "SPAN"
          ? "reserved"
          : el.className.includes("-hard")
            ? "hard"
            : "dollar",
      );

    // The dollar-only pack holds the plutonium line open and vice versa, so
    // both cards put the same currency at the same height.
    expect(lines(pack.key)).toEqual(["dollar", "reserved"]);
    expect(lines(hardPack.key)).toEqual(["reserved", "hard"]);
  });

  it("sells a tier with no Stripe product at its own price", async () => {
    const steamPlus: ResolvedCosmetic = {
      ...platinumSubscription,
      cosmetic: {
        ...(platinumSubscription.cosmetic as object),
        name: "steam_plus",
        priceMonthly: 499,
        product: null,
      } as never,
      key: "subscription:steam_plus",
    };
    resolvedCatalog = [steamPlus];
    const modal = await openStoreOnTab("subscriptions");
    await modal.onUserMe({ player: { subscription: null } } as never);
    await modal.updateComplete;

    const button = purchaseButton(modal, steamPlus.key);
    expect(button.product).toBeNull();
    expect(button.dollarPrice).toBe("$4.99");
    await button.onPurchaseDollar!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      steamPlus,
      "dollar",
      expect.any(Object),
      undefined,
    );
  });

  it("widens a lone subscription card and enlarges its preview", async () => {
    resolvedCatalog = [platinumSubscription];
    const modal = await openStoreOnTab("subscriptions");
    await modal.onUserMe({ player: { subscription: null } } as never);
    await modal.updateComplete;

    const lone = card(modal, platinumSubscription.key)!;
    expect(lone.className).toContain("max-w-xs");
    expect(lone.className).not.toContain("max-w-48");
    expect(lone.previewSize).toBe("detail");
  });

  it("keeps several subscription cards at tile size", async () => {
    resolvedCatalog = [goldSubscription, platinumSubscription];
    const modal = await openStoreOnTab("subscriptions");
    await modal.onUserMe({ player: { subscription: null } } as never);
    await modal.updateComplete;

    for (const key of [goldSubscription.key, platinumSubscription.key]) {
      const tile = card(modal, key)!;
      expect(tile.className).toContain("max-w-48");
      expect(tile.className).not.toContain("max-w-xs");
      expect(tile.previewSize).toBe("card");
    }
  });

  it("shows subscription status and a switch action for another tier", async () => {
    resolvedCatalog = [goldSubscription, platinumSubscription];
    const modal = await openStoreOnTab("subscriptions");
    await modal.onUserMe({
      player: { subscription: { tier: "gold" } },
    } as never);
    await modal.updateComplete;

    const grid = modal.querySelector<HTMLElement>("[data-store-grid]")!;
    expect(grid.className).toMatch(/flex-wrap/);
    expect(grid.className).toMatch(/justify-center/);
    expect(grid.className).toMatch(/p-8/);
    expect(card(modal, goldSubscription.key)?.className).toContain(
      "w-[calc(50%-0.5rem)]",
    );
    expect(card(modal, goldSubscription.key)?.className).toContain("sm:w-48");
    // h-full resolves against the whole wrapping flex container, so a card
    // would grow to the height of every row stacked — the phone layout.
    expect(card(modal, goldSubscription.key)?.className).not.toMatch(/h-full/);

    const status = product(modal, goldSubscription.key)?.querySelector(
      "[data-store-status]",
    );
    expect(status?.textContent).toContain("store.subscribed");
    // Same box as the other tiers' switch button, not a small tag off to one
    // side: full width, a button's height and a button's type size.
    expect(status?.className).toContain("w-full");
    expect(status?.className).toContain("min-h-11");
    expect(status?.className).toContain("text-base");

    await focusCard(modal, platinumSubscription.key);
    const switchButton = purchaseButton(modal, platinumSubscription.key);
    expect(switchButton.dollarLabelKey).toBe("store.switch_button");

    await switchButton.onPurchaseDollar!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      platinumSubscription,
      "dollar",
      expect.any(Object),
      undefined,
    );
  });

  // OPE-440. A grant (`provider: null`) is free access nobody is billing, so
  // the player is not switching anything — every tier, the one their grant
  // confers included, is a first purchase. resolveCosmetics is what stops
  // calling the granted tier "owned" (covered in
  // GrantedSubscriptionPurchase.test.ts); what this asserts is the store's
  // half: a purchasable tier renders its buy button and no dead status box,
  // and the "Switch" label is not applied to a granted player.
  it("offers a plain buy button on every tier to a granted subscriber", async () => {
    resolvedCatalog = [
      { ...goldSubscription, relationship: "purchasable" },
      platinumSubscription,
    ];
    const modal = await openStoreOnTab("subscriptions");
    await modal.onUserMe({
      player: {
        subscription: { tier: "gold", provider: null },
      },
    } as never);
    await modal.updateComplete;

    // The "Subscribed" box was the whole bug: it replaced the buy button.
    expect(
      product(modal, goldSubscription.key)?.querySelector(
        "[data-store-status]",
      ),
    ).toBeFalsy();

    const gold = purchaseButton(modal, goldSubscription.key);
    expect(gold.onPurchaseDollar).toBeTypeOf("function");
    expect(gold.dollarLabelKey).toBe("");

    await focusCard(modal, platinumSubscription.key);
    // Not "Switch": there is no paid plan to switch away from.
    expect(purchaseButton(modal, platinumSubscription.key).dollarLabelKey).toBe(
      "",
    );

    await gold.onPurchaseDollar!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      { ...goldSubscription, relationship: "purchasable" },
      "dollar",
      expect.any(Object),
      undefined,
    );
  });

  it("sells a cosmetic bundle for plutonium with its contents listed", async () => {
    resolvedCatalog = [starterBundle];
    const modal = await openStoreOnTab("bundles");

    expect(card(modal, starterBundle.key)?.state).toBe("focused");
    const button = purchaseButton(modal, starterBundle.key);
    expect(button.priceHard).toBe(250);
    expect(button.priceSoft).toBeNull();
    expect(button.product).toBeNull();
    expect(button.itemName).toBe("Starter Pack");
    expect(
      card(modal, starterBundle.key)?.querySelector(
        "[data-cosmetic-info-items]",
      )?.textContent,
    ).toContain("inventory.selected_cosmetic_variant, Aurora");

    await clickHardPurchase(modal);
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      starterBundle,
      "hard",
      expect.any(Object),
      250,
    );
  });

  it("opens a contents dialog naming each bundle item when a bundle is activated", async () => {
    resolvedCatalog = [starterBundle];
    const modal = await openStoreOnTab("bundles");
    expect(document.querySelector("[data-pack-contents]")).toBeNull();

    card(modal, starterBundle.key)!.onActivate!(starterBundle);
    await modal.updateComplete;
    const dialogHost = modal.querySelector(
      "pack-contents-dialog",
    ) as LitElement;
    await dialogHost.updateComplete;

    // Portaled to the body so it sits above the store modal.
    const dialog = document.body.querySelector<HTMLElement>(
      "[data-pack-contents]",
    )!;
    expect(dialog.closest("store-modal")).toBeNull();
    expect(dialog.getAttribute("aria-label")).toBe("Starter Pack");
    const items = [...dialog.querySelectorAll("[data-pack-contents-item]")];
    expect(
      items.map((item) => item.getAttribute("data-pack-contents-item")),
    ).toEqual(["pattern:stripes:red", "flag:aurora"]);
    expect(items[1].querySelector("cosmetic-preview")).toBeTruthy();
    expect(items[1].textContent).toContain("Aurora");
    // Each item says what kind of cosmetic it is.
    expect(
      items.map(
        (item) => item.querySelector("[data-pack-contents-type]")?.textContent,
      ),
    ).toEqual(["cosmetics.type_skin", "cosmetics.type_flag"]);

    // The bundle can be bought from the dialog too, with the same action as
    // its card.
    const button = dialog.querySelector(
      "[data-pack-contents-action] purchase-button",
    ) as PurchaseButton;
    expect(button.priceHard).toBe(250);
    button.requestCurrencyPurchase("hard");
    await button.updateComplete;
    button
      .querySelector("confirm-dialog")!
      .dispatchEvent(new CustomEvent("confirm"));
    await vi.waitFor(() =>
      expect(purchaseCosmetic).toHaveBeenCalledWith(
        starterBundle,
        "hard",
        expect.any(Object),
        250,
      ),
    );

    dialog
      .querySelector<HTMLButtonElement>("button[aria-label='common.close']")!
      .click();
    await modal.updateComplete;
    expect(document.querySelector("[data-pack-contents]")).toBeNull();
    // The card stays inspected after closing.
    expect(card(modal, starterBundle.key)?.state).toBe("focused");
  });

  it("shows owned and partially owned bundles as a status, not a sale", async () => {
    const owned = { ...starterBundle, relationship: "owned" as const };
    const partial = {
      ...starterBundle,
      relationship: "blocked" as const,
      key: "cosmeticPack:partial",
    };
    resolvedCatalog = [owned, partial];
    const modal = await openStoreOnTab("bundles");
    await modal.onUserMe({ player: { flares: ["flag:aurora"] } } as never);
    await modal.updateComplete;

    expect(modal.querySelector("purchase-button")).toBeNull();
    // The dialog shows the same status instead of a buy button.
    card(modal, owned.key)!.onActivate!(owned);
    await modal.updateComplete;
    await (modal.querySelector("pack-contents-dialog") as LitElement)
      .updateComplete;
    const dialog = document.body.querySelector("[data-pack-contents]")!;
    expect(dialog.querySelector("purchase-button")).toBeNull();
    expect(
      dialog.querySelector("[data-pack-contents-action] [data-store-status]")
        ?.textContent,
    ).toContain("store.pack_owned");
    expect(
      product(modal, owned.key)?.querySelector("[data-store-status]")
        ?.textContent,
    ).toContain("store.pack_owned");
    // The partially owned bundle names the item that blocks it.
    expect(
      product(modal, partial.key)?.querySelector("[data-store-status]")
        ?.textContent,
    ).toContain("store.pack_partially_owned");
  });

  it("hides a bundle blocked for a reason other than partial ownership", async () => {
    resolvedCatalog = [{ ...starterBundle, relationship: "blocked" }];
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    store.open({ tab: "bundles" });
    await store.updateComplete;

    expect(store.querySelector("cosmetic-card")).toBeNull();
    expect(store.textContent).toContain("store.no_bundles");
  });

  it("does not leave an inspected non-affiliate item in affiliate mode", async () => {
    resolvedCatalog = [red, affiliatePattern];
    const modal = await openStoreOnCosmetic("patterns");
    await focusCard(modal, red.key);

    modal.open({ affiliateCode: "creator" });
    await vi.waitFor(() =>
      expect(card(modal, affiliatePattern.key)?.state).toBe("focused"),
    );
    await card(modal, affiliatePattern.key)!.updateComplete;

    expect(modal.querySelector(`[data-cosmetic-key="${red.key}"]`)).toBeNull();
    expect(
      modal.querySelector(`[data-cosmetic-key="${affiliatePattern.key}"]`),
    ).toBeTruthy();

    await purchaseButton(modal, affiliatePattern.key).onPurchaseHard!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      affiliatePattern,
      "hard",
      expect.any(Object),
      120,
    );
  });
});

// The custom-amount card is sold on both rails since OPE-337: the server
// accepts custom_currency on Steam, so the card is offered there too.
describe("StoreModal on the Steam rail", () => {
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  function installSteamShell() {
    const microTxn = {
      subscribe: vi.fn(() => () => {}),
      consumePending: vi.fn(
        async (): Promise<
          { appId: number; orderId: string | null; authorized: boolean }[]
        > => [],
      ),
    };
    (window as any).openfrontDesktop = { steam: { microTxn } };
    return microTxn;
  }

  beforeEach(() => {
    localStorage.clear();
    resolvedCatalog = [pack];
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue({} as Cosmetics);
    vi.mocked(resolveCosmetics).mockReset();
    vi.mocked(resolveCosmetics).mockImplementation(() => resolvedCatalog);
    vi.mocked(purchaseCosmetic).mockReset();
    vi.mocked(purchaseCosmetic).mockResolvedValue(undefined);
  });

  afterEach(() => {
    store?.remove();
    store = undefined;
    delete (window as any).openfrontDesktop;
    localStorage.clear();
  });

  it("offers the custom-amount card on the web", async () => {
    const modal = await openStoreOnTab("packs");
    expect(modal.querySelector("custom-currency-card")).toBeTruthy();
  });

  it("offers the custom-amount card on Steam too", async () => {
    installSteamShell();
    const modal = await openStoreOnTab("packs");
    expect(modal.querySelector("custom-currency-card")).toBeTruthy();
  });

  // REQUIRED, not an optimisation: the main process parks authorizations and
  // its "something arrived" nudge is contentless, so one that fires before any
  // window exists is heard by nobody. subscribe() alone never surfaces it.
  it("drains parked Steam authorizations every time it opens", async () => {
    const microTxn = installSteamShell();
    await openStoreOnTab("packs");
    await vi.waitFor(() => expect(microTxn.consumePending).toHaveBeenCalled());

    // "Every time", not "once per element". Closing and REOPENING the same
    // modal has to drain again: an authorization parked while the player had
    // the store shut is only surfaced by the next open, and a drain wired to
    // first mount rather than to onOpen would strand it there.
    const opened = store!;
    opened.close();
    await opened.updateComplete;
    opened.open({ tab: "packs" });
    await vi.waitFor(() =>
      expect(microTxn.consumePending).toHaveBeenCalledTimes(2),
    );
  });

  it("tells the player about an approval it can no longer finalize", async () => {
    const microTxn = installSteamShell();
    microTxn.consumePending.mockResolvedValueOnce([
      { appId: 480, orderId: "77770000", authorized: true },
    ]);
    const seen: string[] = [];
    const onToast = (e: Event) => seen.push((e as CustomEvent).detail.message);
    window.addEventListener("show-message", onToast);

    await openStoreOnTab("packs");

    await vi.waitFor(() => expect(seen).toContain("store.purchase_pending"));
    window.removeEventListener("show-message", onToast);
  });
});

// The Android app: Google Play is its only way to pay. Packs are listed at
// Play's own price, and nothing else real-money is offered.
describe("StoreModal on the Play rail", () => {
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  const playPack: ResolvedCosmetic = {
    ...pack,
    cosmetic: {
      ...(pack.cosmetic as object),
      googleProductId: "plutonium_1000",
    } as never,
  };
  const otherPack: ResolvedCosmetic = {
    ...pack,
    cosmetic: {
      ...(pack.cosmetic as object),
      name: "plutonium_big",
      googleProductId: "plutonium_5000",
    } as never,
    key: "pack:plutonium_big",
  };
  const webOnlyPack: ResolvedCosmetic = {
    ...pack,
    cosmetic: { ...(pack.cosmetic as object), name: "web_only" } as never,
    key: "pack:web_only",
  };

  function installPlay(products: unknown) {
    const playBilling = {
      products: vi.fn(async () => products),
      purchase: vi.fn(async () => ({ status: "cancelled" })),
      unconsumed: vi.fn(async () => ({ status: "ok", purchaseTokens: [] })),
    };
    (window as any).openfrontDesktop = {
      shell: { platform: "android" },
      playBilling,
    };
    return playBilling;
  }

  async function openPacks() {
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    store.open({ tab: "packs" });
    await vi.waitFor(() =>
      expect(
        store!.querySelector("cosmetic-card, [data-store-play-unavailable]"),
      ).toBeTruthy(),
    );
    return store;
  }

  beforeEach(() => {
    localStorage.clear();
    resolvedCatalog = [playPack, otherPack, webOnlyPack];
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue({
      currencyPacks: Object.fromEntries(
        resolvedCatalog.map((r) => [r.cosmetic!.name, r.cosmetic]),
      ),
    } as unknown as Cosmetics);
    vi.mocked(resolveCosmetics).mockReset();
    vi.mocked(resolveCosmetics).mockImplementation(() => resolvedCatalog);
    vi.mocked(purchaseCosmetic).mockReset();
    vi.mocked(purchaseCosmetic).mockResolvedValue(undefined);
  });

  afterEach(() => {
    store?.remove();
    store = undefined;
    delete (window as any).openfrontDesktop;
    localStorage.clear();
  });

  it("lists only the packs Play returned, at Play's price, with no Stripe checkout", async () => {
    const play = installPlay({
      status: "ok",
      products: [{ productId: "plutonium_1000", formattedPrice: "€5,49" }],
    });
    const modal = await openPacks();

    expect(play.products).toHaveBeenCalledWith([
      "plutonium_1000",
      "plutonium_5000",
    ]);
    const button = purchaseButton(modal, playPack.key);
    expect(button.dollarPrice).toBe("€5,49");
    expect(button.product).toBeNull();
    expect(button.inlineCheckout).toBeNull();
    await button.onPurchaseDollar!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      playPack,
      "dollar",
      expect.any(Object),
      undefined,
    );

    // The catalog's dollar price shows nowhere, on the card or in its preview.
    expect(card(modal, playPack.key)!.textContent).toContain("1,000");
    expect(modal.querySelector("[data-pack-price]")).toBeNull();
    expect(modal.textContent).not.toContain("$5");

    // Not returned by Play, and not on Play at all.
    expect(card(modal, otherPack.key)).toBeUndefined();
    expect(card(modal, webOnlyPack.key)).toBeUndefined();
    expect(modal.querySelector("custom-currency-card")).toBeNull();
    expect(modal.querySelector("[data-store-play-unavailable]")).toBeNull();
  });

  it("lists no pack and says so when Play cannot price them", async () => {
    installPlay({ status: "error", code: "unavailable" });
    const modal = await openPacks();

    expect(modal.querySelector("cosmetic-card")).toBeNull();
    expect(modal.querySelector("custom-currency-card")).toBeNull();
    expect(
      modal.querySelector("[data-store-play-unavailable]")?.textContent,
    ).toContain("store.play_unavailable");
  });

  it("asks Play again when the store reopens after it could not price the packs", async () => {
    const play = installPlay({ status: "error", code: "unavailable" });
    const modal = await openPacks();
    expect(modal.querySelector("[data-store-play-unavailable]")).toBeTruthy();
    modal.close();

    // The catalog itself is still fresh.
    play.products.mockResolvedValue({
      status: "ok",
      products: [{ productId: "plutonium_1000", formattedPrice: "€5,49" }],
    });
    modal.open({ tab: "packs" });
    await vi.waitFor(() =>
      expect(purchaseButton(modal, playPack.key).dollarPrice).toBe("€5,49"),
    );
    expect(play.products).toHaveBeenCalledTimes(2);
    expect(modal.querySelector("[data-store-play-unavailable]")).toBeNull();
  });

  it("sells nothing for real money in an Android app without the bridge", async () => {
    (window as any).openfrontDesktop = { shell: { platform: "android" } };
    const modal = await openPacks();

    expect(modal.querySelector("cosmetic-card")).toBeNull();
    expect(modal.querySelector("custom-currency-card")).toBeNull();
    expect(modal.querySelector("[data-store-play-unavailable]")).toBeTruthy();
  });

  // A purchase updates the balance by sending the account afresh, and every
  // account the store receives also reloads the catalog, which asks Play for
  // prices again. The header must not wait on Play.
  it("shows a new balance while Play is still pricing the packs", async () => {
    const play = installPlay({
      status: "ok",
      products: [{ productId: "plutonium_1000", formattedPrice: "€5,49" }],
    });
    const modal = await openPacks();
    const account = (hard: number) =>
      ({
        player: { publicId: "p", flares: [], currency: { hard, soft: 0 } },
      }) as never;
    const balance = () =>
      modal.querySelector<CurrencyDisplay>("currency-display")?.hard;
    await modal.onUserMe(account(100));
    await modal.updateComplete;
    expect(balance()).toBe(100);

    const asked = play.products.mock.calls.length;
    play.products.mockReturnValue(new Promise(() => {}));
    void modal.onUserMe(account(1_100));
    await vi.waitFor(() =>
      expect(play.products).toHaveBeenCalledTimes(asked + 1),
    );
    await modal.updateComplete;
    expect(balance()).toBe(1_100);
  });

  it("sells no subscription, but still shows the one the player holds", async () => {
    installPlay({ status: "ok", products: [] });
    resolvedCatalog = [goldSubscription, platinumSubscription];
    const modal = await openStoreOnTab("subscriptions");
    await modal.onUserMe({
      player: { subscription: { tier: "gold" } },
    } as never);
    await modal.updateComplete;

    expect(card(modal, goldSubscription.key)).toBeTruthy();
    expect(card(modal, platinumSubscription.key)).toBeUndefined();
  });
});

describe("store analytics", () => {
  Element.prototype.animate ??= () => ({ cancel: () => {} }) as Animation;

  type Entry = {
    target: Element;
    isIntersecting: boolean;
    intersectionRatio: number;
  };
  class FakeIO {
    static instances: FakeIO[] = [];
    observed = new Set<Element>();
    constructor(public cb: (entries: Entry[]) => void) {
      FakeIO.instances.push(this);
    }
    observe(el: Element) {
      this.observed.add(el);
    }
    unobserve(el: Element) {
      this.observed.delete(el);
    }
    disconnect() {
      this.observed.clear();
    }
  }
  // Report a card as shown (or hidden) to whichever observer watches it.
  function setVisible(el: Element, isIntersecting: boolean) {
    for (const io of FakeIO.instances) {
      if (io.observed.has(el)) {
        io.cb([
          {
            target: el,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
          },
        ]);
      }
    }
  }

  let fetchSpy: ReturnType<typeof vi.fn>;
  function sent() {
    return fetchSpy.mock.calls
      .filter(([url]) => String(url).endsWith("/store/events"))
      .flatMap(([, init]) => JSON.parse(init.body).events);
  }

  beforeEach(() => {
    FakeIO.instances = [];
    (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
    vi.stubGlobal("IntersectionObserver", FakeIO);
    fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    localStorage.clear();
    const settings = new UserSettings();
    settings.removeCached(PATTERN_KEY);
    settings.removeCached(EFFECTS_KEY);
    resolvedCatalog = [
      red,
      blue,
      green,
      flag,
      wake,
      atom,
      pack,
      goldSubscription,
      platinumSubscription,
      starterBundle,
    ];
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue({} as Cosmetics);
    vi.mocked(resolveCosmetics).mockReset();
    vi.mocked(resolveCosmetics).mockImplementation(
      (_cosmetics, _userMeResponse, affiliateCode) =>
        affiliateCode
          ? resolvedCatalog.filter(
              (item) =>
                item.cosmetic !== null &&
                "affiliateCode" in item.cosmetic &&
                item.cosmetic.affiliateCode === affiliateCode,
            )
          : resolvedCatalog,
    );
    vi.mocked(purchaseCosmetic).mockReset();
  });

  afterEach(() => {
    store?.remove();
    store = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    localStorage.clear();
  });

  function placementOf(modal: StoreModal, el: Element) {
    return (
      modal as unknown as { placementFor(el: Element): unknown }
    ).placementFor(el);
  }

  function keysOf(modal: StoreModal): string[] {
    return [...modal.querySelectorAll<HTMLElement>("[data-store-product]")].map(
      (el) => el.dataset.cosmeticKey ?? "",
    );
  }

  it("gives every product tile a cosmetic key on every tab", async () => {
    for (const tab of ["packs", "subscriptions", "bundles"] as const) {
      const modal = await openStoreOnTab(tab);
      const keys = keysOf(modal);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((key) => key !== "")).toBe(true);
      modal.remove();
      store = undefined;
    }
    const cosmetics = await openStoreOnCosmetic("patterns");
    expect(keysOf(cosmetics).length).toBeGreaterThan(0);
    expect(keysOf(cosmetics).every((key) => key !== "")).toBe(true);
    cosmetics.remove();
    store = undefined;

    const { store: effects } = await openEffectsStore();
    expect(keysOf(effects)).toContain(wake.key);
    expect(keysOf(effects).every((key) => key !== "")).toBe(true);
  });

  it("places a card by tab, sub-tab, flash hero or affiliate mode", async () => {
    const modal = await openStoreOnCosmetic("flags");
    const el = product(modal, flag.key)!;
    expect(placementOf(modal, el)).toEqual({
      kind: "tab",
      tab: "cosmetics",
      subTab: "flags",
    });

    const hero = document.createElement("section");
    hero.setAttribute("data-store-flash", "");
    const inner = document.createElement("div");
    hero.appendChild(inner);
    expect(placementOf(modal, inner)).toEqual({ kind: "flash" });

    modal.setActiveTab("packs");
    await modal.updateComplete;
    expect(placementOf(modal, el)).toEqual({ kind: "tab", tab: "packs" });

    (modal as unknown as { affiliateCode: string }).affiliateCode = "creator";
    expect(placementOf(modal, el)).toEqual({ kind: "affiliate" });
  });

  it("records a click with the card's placement when it is activated", async () => {
    const modal = await openStoreOnCosmetic("flags");
    await focusCard(modal, flag.key);
    (modal as unknown as { tracker: { flush(): void } }).tracker.flush();
    expect(sent()).toEqual([
      {
        type: "click",
        item: flag.key,
        placement: { kind: "tab", tab: "cosmetics", subTab: "flags" },
      },
    ]);
  });

  it("does not count a preview from inside a bundle's contents as a click", async () => {
    const modal = await openStoreOnCosmetic("flags");
    const dialog = document.createElement("pack-contents-dialog");
    modal.appendChild(dialog);
    dialog.dispatchEvent(
      new CustomEvent("open-cosmetic-preview", {
        detail: flag,
        bubbles: true,
        composed: true,
      }),
    );
    dialog.remove();
    const tracker = (modal as unknown as { tracker: { flush(): void } })
      .tracker;
    tracker.flush();
    expect(sent()).toEqual([]);
    await focusCard(modal, flag.key);
    tracker.flush();
    expect(sent()).toEqual([
      {
        type: "click",
        item: flag.key,
        placement: { kind: "tab", tab: "cosmetics", subTab: "flags" },
      },
    ]);
  });

  it("flushes queued events when the store closes", async () => {
    const modal = await openStoreOnCosmetic("flags");
    await focusCard(modal, flag.key);
    expect(sent()).toEqual([]);
    modal.close();
    expect(sent()).toHaveLength(1);
  });

  it("records an impression after a second in view, and again after a reopen", async () => {
    initNavigation();
    const modal = await openStoreOnCosmetic("flags");
    modal.classList.add("page-content");
    const el = product(modal, flag.key)!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    setVisible(el, true);
    vi.advanceTimersByTime(1000);
    modal.close();
    expect(modal.classList.contains("hidden")).toBe(true);
    expect(sent()).toEqual([
      {
        type: "impression",
        item: flag.key,
        placement: { kind: "tab", tab: "cosmetics", subTab: "flags" },
      },
    ]);

    // Closing hides the store with display: none, so the browser reports the
    // card as not intersecting, then intersecting again on reopen.
    setVisible(el, false);
    modal.open({ tab: "cosmetics" });
    await modal.updateComplete;
    setVisible(el, true);
    vi.advanceTimersByTime(1000);
    modal.close();
    expect(sent().filter((e) => e.type === "impression")).toHaveLength(2);
  });

  it("follows a reused card element to its new item", async () => {
    resolvedCatalog = [red, flag];
    const modal = await openStoreOnCosmetic("patterns");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const first = modal.querySelector<HTMLElement>("[data-store-product]")!;
    expect(first.dataset.cosmeticKey).toBe(red.key);
    setVisible(first, true);
    vi.advanceTimersByTime(1000);

    first.dataset.cosmeticKey = flag.key;
    (modal as unknown as { requestUpdate(): void }).requestUpdate();
    await modal.updateComplete;
    setVisible(first, true);
    vi.advanceTimersByTime(1000);
    modal.close();
    expect(
      sent()
        .filter((e) => e.type === "impression")
        .map((e) => e.item),
    ).toEqual(["pattern:stripes", flag.key]);
  });

  it("records a palette click and impression under the pattern card", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setVisible(product(modal, red.key)!, true);
    vi.advanceTimersByTime(1000);
    await activateVariant(modal, blue.key);
    await focusCard(modal, blue.key);
    modal.close();
    expect(sent().map((e) => [e.type, e.item])).toEqual([
      ["impression", "pattern:stripes"],
      ["click", "pattern:stripes"],
    ]);
  });

  it("prunes detached cards once per store update, not once per card", async () => {
    const modal = await openStoreOnTab("subscriptions");
    expect(keysOf(modal).length).toBeGreaterThan(1);
    const tracker = (modal as unknown as { tracker: StoreTracker }).tracker;
    const release = vi.spyOn(tracker, "releaseDetached");
    const observe = vi.spyOn(tracker, "observe");
    (modal as unknown as { requestUpdate(): void }).requestUpdate();
    await modal.updateComplete;
    expect(observe.mock.calls.length).toBeGreaterThan(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("watches the effect tiles the grid renders after the store does", async () => {
    const { store: modal } = await openEffectsStore();
    const el = product(modal, wake.key)!;
    await vi.waitFor(() =>
      expect(FakeIO.instances.some((io) => io.observed.has(el))).toBe(true),
    );
  });
  // Store experiments: a refetched catalog (the player's group landed late,
  // or a purchase met a changed price) re-renders the open store, and the
  // flash card gets an exposure watcher of its own, so analytics never count
  // the card twice in one page view.
  it("re-renders on a refetched catalog without counting the flash card twice", async () => {
    resetExperimentsForTest();
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    const flashSale = {
      id: "40",
      name: "Hot sale",
      percentOff: 35,
      endsAt,
      kind: "flash" as const,
    };
    const plain = {
      patterns: {},
      flags: {},
      promotions: [flashSale],
    } as unknown as Cosmetics;
    vi.mocked(fetchCosmetics).mockResolvedValue(plain);
    const zap: ResolvedCosmetic = {
      ...red,
      cosmetic: {
        ...pattern,
        name: "zap",
        priceHard: 52,
        listPriceHard: 80,
        promotion: flashSale,
      } as never,
      key: "pattern:zap:red",
    };
    resolvedCatalog = [red, zap];
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    store.open({ tab: "cosmetics", sub: "sale" });
    const modal = store;
    await vi.waitFor(() =>
      expect(modal.querySelector("[data-store-flash]")).toBeTruthy(),
    );
    const hero = modal.querySelector("[data-store-flash]")!;
    // Watched by the tracker (its card) and by the exposure watcher (the hero).
    await vi.waitFor(() =>
      expect(FakeIO.instances.some((io) => io.observed.has(hero))).toBe(true),
    );
    const heroCard = hero.querySelector("[data-store-product]")!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setVisible(heroCard, true);
    vi.advanceTimersByTime(1000);

    // The Deeper group's catalog lands.
    const deeper = {
      ...plain,
      promotions: [{ ...flashSale, percentOff: 45 }],
    } as unknown as Cosmetics;
    vi.mocked(fetchCosmetics).mockResolvedValue(deeper);
    vi.mocked(resolveCosmetics).mockClear();
    publishExperimentsForTest(
      [
        {
          key: "daily_deal_depth_1",
          surface: "flash_sale_depth",
          variant: "deeper",
          counted: true,
        },
      ],
      "daily_deal_depth_1.deeper",
    );
    document.dispatchEvent(
      new CustomEvent(COSMETICS_CHANGED, { detail: deeper }),
    );
    await vi.waitFor(() =>
      expect(vi.mocked(resolveCosmetics).mock.calls[0]?.[0]).toBe(deeper),
    );
    await modal.updateComplete;
    expect(modal.querySelector("[data-store-flash]")!.textContent).toContain(
      "store.flash_sale_hero_title",
    );

    // Seen again after the re-render: still one impression this page view.
    setVisible(heroCard, false);
    setVisible(heroCard, true);
    vi.advanceTimersByTime(1000);
    modal.close();
    expect(
      sent().filter(
        (e: { type: string; item: string }) =>
          e.type === "impression" && e.item === "pattern:zap",
      ),
    ).toHaveLength(1);
    resetExperimentsForTest();
  });

  it("stops watching the flash card for an exposure when the store closes", async () => {
    resetExperimentsForTest();
    const flashSale = {
      id: "40",
      name: "Hot sale",
      percentOff: 35,
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      kind: "flash" as const,
    };
    vi.mocked(fetchCosmetics).mockResolvedValue({
      patterns: {},
      flags: {},
      promotions: [flashSale],
    } as unknown as Cosmetics);
    resolvedCatalog = [
      red,
      {
        ...red,
        cosmetic: {
          ...pattern,
          name: "zap",
          priceHard: 52,
          listPriceHard: 80,
          promotion: flashSale,
        } as never,
        key: "pattern:zap:red",
      },
    ];
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    const modal = store;
    const watched = () => {
      const hero = modal.querySelector("[data-store-flash]");
      return (
        hero !== null && FakeIO.instances.some((io) => io.observed.has(hero))
      );
    };
    modal.open({ tab: "cosmetics", sub: "sale" });
    await vi.waitFor(() => expect(watched()).toBe(true));

    // Hidden, not removed: the clock stops at once, not when the observer
    // gets round to reporting it.
    modal.close();
    await modal.updateComplete;
    expect(modal.querySelector("[data-store-flash]")).toBeTruthy();
    expect(watched()).toBe(false);

    // Reopened: watched again, from a fresh interval.
    modal.open({ tab: "cosmetics", sub: "sale" });
    await vi.waitFor(() => expect(watched()).toBe(true));
    resetExperimentsForTest();
  });

  // Featured leads with the deal hero (data-featured-section="deal"), the
  // same flash card the On sale tab shows: it is watched for an exposure too.
  it("watches the Featured deal hero for an exposure", async () => {
    resetExperimentsForTest();
    const flashSale = {
      id: "40",
      name: "Hot sale",
      percentOff: 35,
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      kind: "flash" as const,
    };
    vi.mocked(fetchCosmetics).mockResolvedValue({
      patterns: {},
      flags: {},
      promotions: [flashSale],
    } as unknown as Cosmetics);
    resolvedCatalog = [
      red,
      {
        ...red,
        cosmetic: {
          ...pattern,
          name: "zap",
          priceHard: 52,
          listPriceHard: 80,
          promotion: flashSale,
        } as never,
        key: "pattern:zap:red",
      },
    ];
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    const modal = store;
    modal.open();
    await vi.waitFor(() => {
      const hero = modal.querySelector('[data-featured-section="deal"]');
      expect(hero).toBeTruthy();
      expect(FakeIO.instances.some((io) => io.observed.has(hero!))).toBe(true);
    });
    resetExperimentsForTest();
  });

  it("moves an open bundle dialog onto a refetched catalog's price", async () => {
    resolvedCatalog = [starterBundle];
    const modal = await openStoreOnTab("bundles");
    card(modal, starterBundle.key)!.onActivate!(starterBundle);
    await modal.updateComplete;
    const dialogButton = async () => {
      const host = modal.querySelector(
        "pack-contents-dialog",
      ) as LitElement | null;
      await host?.updateComplete;
      return document.body.querySelector(
        "[data-pack-contents-action] purchase-button",
      ) as PurchaseButton | null;
    };
    expect((await dialogButton())!.priceHard).toBe(250);

    // A purchase met a changed price; the catalog is refetched at 300.
    const repriced: ResolvedCosmetic = {
      ...starterBundle,
      cosmetic: { ...(starterBundle.cosmetic as object), priceHard: 300 },
    } as ResolvedCosmetic;
    resolvedCatalog = [repriced];
    vi.mocked(fetchCosmetics).mockResolvedValue({} as Cosmetics);
    document.dispatchEvent(new CustomEvent(COSMETICS_CHANGED, { detail: {} }));
    await vi.waitFor(async () =>
      expect((await dialogButton())?.priceHard).toBe(300),
    );

    // Gone from the catalog: the dialog closes rather than sell it.
    resolvedCatalog = [];
    vi.mocked(fetchCosmetics).mockResolvedValue({} as Cosmetics);
    document.dispatchEvent(new CustomEvent(COSMETICS_CHANGED, { detail: {} }));
    await vi.waitFor(() =>
      expect(document.body.querySelector("[data-pack-contents]")).toBeNull(),
    );
  });
});

// A Store link to a card item opens the Card sub-tab and hands the item to
// its grid, which selects it; once shown, the Store stops asking.
describe("StoreModal: a link to a card item", () => {
  beforeEach(() => {
    resolvedCatalog = [red, blue, green, flag, wake, atom, hydro, hydroAlt];
    vi.mocked(fetchCosmetics).mockReset();
    vi.mocked(fetchCosmetics).mockResolvedValue({} as Cosmetics);
    vi.mocked(resolveCosmetics).mockReset();
    vi.mocked(resolveCosmetics).mockImplementation(() => resolvedCatalog);
  });
  afterEach(() => {
    store?.remove();
    store = undefined;
  });

  it("passes the item to the card grid, and stops asking once it's shown", async () => {
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    store.open({ tab: "cosmetics", item: "cardBackground:bg_storm_front" });
    await vi.waitFor(() =>
      expect(store!.querySelector("card-store-grid")).toBeTruthy(),
    );
    const grid = store.querySelector("card-store-grid") as unknown as {
      requestedItem: string | null;
    } & HTMLElement;
    expect(grid.requestedItem).toBe("cardBackground:bg_storm_front");
    grid.dispatchEvent(
      new CustomEvent("requested-item-shown", { bubbles: true }),
    );
    expect(
      (store as unknown as { requestedItem: string | null }).requestedItem,
    ).toBeNull();
  });

  it("closing the Store closes a card preview left open", async () => {
    // The Store hides without disconnecting its grid, so a preview left
    // open would keep its Tab trap (and show again on the next open).
    store = document.createElement("store-modal") as StoreModal;
    store.inline = true;
    document.body.appendChild(store);
    await store.updateComplete;
    store.open({ tab: "cosmetics", item: "cardBackground:bg_storm_front" });
    await vi.waitFor(() =>
      expect(store!.querySelector("card-store-grid")).toBeTruthy(),
    );
    const grid = store.querySelector("card-store-grid") as unknown as {
      previewing: unknown;
      updateComplete: Promise<unknown>;
    };
    grid.previewing = {
      type: "cardBackground",
      item: { name: "bg_storm_front", rarity: "common" },
    };
    await grid.updateComplete;
    store.close();
    await grid.updateComplete;
    expect(grid.previewing).toBeNull();
    expect(store.querySelector("card-item-preview")).toBeNull();
  });
});
