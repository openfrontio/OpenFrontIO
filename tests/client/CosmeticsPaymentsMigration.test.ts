import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  changeSubscriptionTier: vi.fn(),
  createCheckoutSession: vi.fn(),
  getApiBase: vi.fn(() => "https://api.test"),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
  purchaseCosmeticPack: vi.fn(),
  purchaseWithCurrency: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => true),
  showInGameConfirm: vi.fn(async () => true),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

vi.mock("../../src/client/Payments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Payments")>()),
  startPurchase: vi.fn(async () => ({ outcome: "redirecting" })),
}));

import {
  createCheckoutSession,
  getUserMe,
  invalidateUserMe,
} from "../../src/client/Api";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import { purchaseCosmetic, resolveCosmetics } from "../../src/client/Cosmetics";
import { showInGameAlert } from "../../src/client/InGameModal";
import { startPurchase } from "../../src/client/Payments";
import type { Cosmetics, Pack, Pattern } from "../../src/core/CosmeticSchemas";

const startPurchaseMock = startPurchase as unknown as ReturnType<typeof vi.fn>;
const createCheckoutSessionMock =
  createCheckoutSession as unknown as ReturnType<typeof vi.fn>;
const alertMock = showInGameAlert as unknown as ReturnType<typeof vi.fn>;

// A Steam-only currency pack: it is sold on Steam, so it has no Stripe
// product block at all. `product` is nullable in the schema precisely for it.
const STEAM_ONLY_PACK = {
  name: "starter_pack",
  product: null,
  rarity: "common",
} as unknown as Pack;

const STRIPE_PACK = {
  name: "starter_pack",
  product: { productId: "prod_1", priceId: "price_1", price: "$4.99" },
  rarity: "common",
} as unknown as Pack;

function resolved(over: Partial<ResolvedCosmetic>): ResolvedCosmetic {
  return {
    type: "pack",
    cosmetic: STEAM_ONLY_PACK,
    colorPalette: null,
    relationship: "purchasable",
    key: "pack:starter_pack",
    ...over,
  } as ResolvedCosmetic;
}

beforeEach(() => {
  vi.clearAllMocks();
  startPurchaseMock.mockResolvedValue({ outcome: "redirecting" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveCosmetics: currency packs no longer gate on the Stripe product", () => {
  // OPE-231 bug 1: `pack.product ? "purchasable" : "blocked"` rendered every
  // Steam-only pack as blocked, so its buy button never appeared.
  it("marks a Steam-only pack (product: null) purchasable", () => {
    const cosmetics = {
      patterns: {},
      flags: {},
      colorPalettes: {},
      currencyPacks: { starter_pack: STEAM_ONLY_PACK },
    } as unknown as Cosmetics;

    const items = resolveCosmetics(cosmetics, false, null);
    const pack = items.find((i) => i.key === "pack:starter_pack");

    expect(pack).toBeDefined();
    expect(pack!.relationship).toBe("purchasable");
  });

  it("still marks a Stripe-backed pack purchasable", () => {
    const cosmetics = {
      patterns: {},
      flags: {},
      colorPalettes: {},
      currencyPacks: { starter_pack: STRIPE_PACK },
    } as unknown as Cosmetics;

    const pack = resolveCosmetics(cosmetics, false, null).find(
      (i) => i.key === "pack:starter_pack",
    );
    expect(pack!.relationship).toBe("purchasable");
  });
});

describe("purchaseCosmetic dollar path", () => {
  // OPE-231 bug 2: the dollar path early-returned store.checkout_failed for
  // any listing without a Stripe product, which is every Steam-only one.
  it("buys a Steam-only currency pack by NAME instead of failing", async () => {
    await purchaseCosmetic(resolved({}), "dollar");

    expect(startPurchaseMock).toHaveBeenCalledWith({
      kind: "currency_pack",
      packName: "starter_pack",
    });
    expect(alertMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("buys a subscription tier by name", async () => {
    await purchaseCosmetic(
      resolved({
        type: "subscription",
        cosmetic: { name: "supporter", priceMonthly: 5 } as any,
        key: "subscription:supporter",
      }),
      "dollar",
    );

    expect(startPurchaseMock).toHaveBeenCalledWith({
      kind: "subscription_tier",
      tierName: "supporter",
    });
  });

  // The cosmetic/flare branch of the legacy Stripe endpoint was deliberately
  // never ported, and it genuinely still needs a priceId.
  it("keeps the legacy Stripe path for dollar-priced cosmetics", async () => {
    createCheckoutSessionMock.mockResolvedValue("https://stripe.test/session");
    const pattern = {
      name: "camo",
      product: { productId: "prod_p", priceId: "price_p", price: "$1.99" },
      rarity: "common",
    } as unknown as Pattern;

    await purchaseCosmetic(
      resolved({
        type: "pattern",
        cosmetic: pattern,
        colorPalette: { name: "blue" } as any,
        key: "pattern:camo",
      }),
      "dollar",
    );

    expect(createCheckoutSessionMock).toHaveBeenCalledWith("price_p", "blue");
    expect(startPurchaseMock).not.toHaveBeenCalled();
  });

  it("still reports a failure for a dollar-priced cosmetic with no Stripe price", async () => {
    await purchaseCosmetic(
      resolved({
        type: "pattern",
        cosmetic: { name: "camo", product: null, rarity: "common" } as any,
        key: "pattern:camo",
      }),
      "dollar",
    );

    expect(alertMock).toHaveBeenCalledWith("store.checkout_failed");
    expect(startPurchaseMock).not.toHaveBeenCalled();
  });
});

describe("purchaseCosmetic dollar path: settling a Steam overlay purchase", () => {
  it("says nothing while a redirect is under way", async () => {
    startPurchaseMock.mockResolvedValue({ outcome: "redirecting" });
    await purchaseCosmetic(resolved({}), "dollar");
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("confirms a completed pack purchase", async () => {
    startPurchaseMock.mockResolvedValue({ outcome: "completed" });
    await purchaseCosmetic(resolved({}), "dollar");
    expect(alertMock).toHaveBeenCalledWith(
      "store.currency_pack_purchase_success",
    );
  });

  it("tells the player nothing was charged when they cancelled", async () => {
    startPurchaseMock.mockResolvedValue({ outcome: "cancelled" });
    await purchaseCosmetic(resolved({}), "dollar");
    expect(alertMock).toHaveBeenCalledWith("store.steam_overlay_cancelled");
  });

  // invalidateUserMe() only drops the cache. On the overlay path the page
  // never navigates, so without a fetch AND a broadcast an open StoreModal
  // keeps rendering the balance it had before the purchase settled.
  it("refetches and broadcasts the profile after a completed purchase", async () => {
    const fresh = { player: { currency: { hard: 500 } } };
    vi.mocked(getUserMe).mockResolvedValue(fresh as never);
    startPurchaseMock.mockResolvedValue({ outcome: "completed" });
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener("userMeResponse", onEvent);

    await purchaseCosmetic(resolved({}), "dollar");

    document.removeEventListener("userMeResponse", onEvent);
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(seen).toEqual([fresh]);
  });

  // getUserMe returns false on ANY error, not just auth. Broadcasting that
  // would flip the app to its logged-out UI right after a purchase succeeded.
  it("does not broadcast a failed profile read", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false as never);
    startPurchaseMock.mockResolvedValue({ outcome: "completed" });
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener("userMeResponse", onEvent);

    await purchaseCosmetic(resolved({}), "dollar");

    document.removeEventListener("userMeResponse", onEvent);
    expect(seen).toEqual([]);
  });

  it("shows a checkout error's own message", async () => {
    startPurchaseMock.mockResolvedValue({
      outcome: "error",
      message: "You already subscribe through Stripe.",
      refetchCatalog: false,
    });
    await purchaseCosmetic(resolved({}), "dollar");
    expect(alertMock).toHaveBeenCalledWith(
      "You already subscribe through Stripe.",
    );
  });
});
