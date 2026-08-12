import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";
import "../../src/client/Store";
import type { StoreModal } from "../../src/client/Store";
import type { CosmeticCard } from "../../src/client/components/CosmeticCard";
import type { EffectsGrid } from "../../src/client/components/EffectsGrid";
import type { PurchaseButton } from "../../src/client/components/PurchaseButton";
import type { Cosmetics, Effect } from "../../src/core/CosmeticSchemas";
import {
  EFFECTS_KEY,
  PATTERN_KEY,
  UserSettings,
} from "../../src/core/game/UserSettings";

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(),
  purchaseCosmetic: vi.fn(),
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

const affiliatePattern: ResolvedCosmetic = {
  ...red,
  cosmetic: {
    ...pattern,
    affiliateCode: "creator",
    product: {
      productId: "affiliate-pattern",
      priceId: "affiliate-pattern-price",
      price: "$3",
    },
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

async function openStoreOnTab(tab: "packs" | "subscriptions") {
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
              (item) => item.cosmetic?.affiliateCode === affiliateCode,
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

  it("selects the first visible item and purchases the selected variant", async () => {
    const modal = await openStoreOnCosmetic("patterns");
    expect(card(modal, red.key)?.activeVariantKey).toBe(red.key);

    await focusCard(modal, blue.key);
    await activateVariant(modal, blue.key);
    await clickHardPurchase(modal);

    await vi.waitFor(() =>
      expect(purchaseCosmetic).toHaveBeenCalledWith(blue, "hard"),
    );
    expect(localStorage.getItem(PATTERN_KEY)).toBeNull();
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
      expect(purchaseCosmetic).toHaveBeenCalledWith(red, "hard"),
    );
    expect(
      (
        vi.mocked(purchaseCosmetic).mock.calls[0]![0].cosmetic as {
          priceHard: number;
        }
      ).priceHard,
    ).toBe(120);
    expect(purchaseCosmetic).not.toHaveBeenCalledWith(blue, "hard");
    expect(localStorage.getItem(PATTERN_KEY)).toBeNull();
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
    expect(purchaseCosmetic).toHaveBeenCalledWith(hydro, "hard");
    expect(localStorage.getItem(EFFECTS_KEY)).toBeNull();
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
    expect(modal.querySelector("[data-store-product]")).toBeNull();
    expect(modal.querySelector("purchase-button")).toBeNull();
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
    expect(card(modal, pack.key)?.state).toBe("focused");
    expect(purchaseButton(modal, pack.key).closest("cosmetic-card")).toBe(
      card(modal, pack.key),
    );

    await purchaseButton(modal, pack.key).onPurchaseDollar!();

    expect(purchaseCosmetic).toHaveBeenCalledWith(pack, "dollar");
  });

  it("shows subscription status and a switch action for another tier", async () => {
    resolvedCatalog = [goldSubscription, platinumSubscription];
    const modal = await openStoreOnTab("subscriptions");
    await modal.onUserMe({
      player: { subscription: { tier: "gold" } },
    } as never);
    await modal.updateComplete;

    expect(
      product(modal, goldSubscription.key)?.querySelector("[data-store-status]")
        ?.textContent,
    ).toContain("store.subscribed");

    await focusCard(modal, platinumSubscription.key);
    const switchButton = purchaseButton(modal, platinumSubscription.key);
    expect(switchButton.dollarLabelKey).toBe("store.switch_button");

    await switchButton.onPurchaseDollar!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(
      platinumSubscription,
      "dollar",
    );
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

    await purchaseButton(modal, affiliatePattern.key).onPurchaseDollar!();
    expect(purchaseCosmetic).toHaveBeenCalledWith(affiliatePattern, "dollar");
  });
});
