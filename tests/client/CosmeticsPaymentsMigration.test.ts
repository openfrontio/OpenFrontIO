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
  changeSubscriptionTier,
  createCheckoutSession,
  getUserMe,
  invalidateUserMe,
} from "../../src/client/Api";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import { purchaseCosmetic, resolveCosmetics } from "../../src/client/Cosmetics";
import {
  showInGameAlert,
  showInGameConfirm,
} from "../../src/client/InGameModal";
import { startPurchase } from "../../src/client/Payments";
import type { Cosmetics, Pack, Pattern } from "../../src/core/CosmeticSchemas";

const startPurchaseMock = startPurchase as unknown as ReturnType<typeof vi.fn>;
const createCheckoutSessionMock =
  createCheckoutSession as unknown as ReturnType<typeof vi.fn>;
const alertMock = showInGameAlert as unknown as ReturnType<typeof vi.fn>;
const getUserMeMock = getUserMe as unknown as ReturnType<typeof vi.fn>;
const confirmMock = showInGameConfirm as unknown as ReturnType<typeof vi.fn>;
const changeTierMock = changeSubscriptionTier as unknown as ReturnType<
  typeof vi.fn
>;

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

  // Phase 9 (OPE-230). A subscriber picking a DIFFERENT tier: on Stripe the
  // change is an in-place reprice (change-tier); on Steam there is no such
  // thing — the change is a fresh checkout for the new tier, whose approval
  // makes Steam disable the old agreement. Nothing is cancelled first.
  describe("changing tier as an existing subscriber", () => {
    const warlord = () =>
      resolved({
        type: "subscription",
        cosmetic: { name: "warlord", priceMonthly: 10 } as any,
        key: "subscription:warlord",
      });

    function subscribedOn(provider: "stripe" | "steam") {
      getUserMeMock.mockResolvedValue({
        player: {
          subscription: {
            tier: "vanguard",
            status: "active",
            provider,
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null,
          },
        },
      });
    }

    it("a Steam subscriber goes through a fresh checkout, never change-tier", async () => {
      subscribedOn("steam");
      startPurchaseMock.mockResolvedValue({ outcome: "completed" });
      await purchaseCosmetic(warlord(), "dollar");
      // The confirm never promises proration on Steam — full price now, the
      // rest of the month forfeited.
      expect(confirmMock).toHaveBeenCalledWith(
        "store.confirm_tier_change_steam",
        expect.anything(),
      );
      expect(startPurchaseMock).toHaveBeenCalledWith({
        kind: "subscription_tier",
        tierName: "warlord",
      });
      expect(changeTierMock).not.toHaveBeenCalled();
      expect(alertMock).toHaveBeenCalledWith("store.change_tier_success_steam");
    });

    it("a Stripe subscriber still reprices in place", async () => {
      subscribedOn("stripe");
      changeTierMock.mockResolvedValue(true);
      await purchaseCosmetic(warlord(), "dollar");
      expect(confirmMock).toHaveBeenCalledWith(
        "store.confirm_upgrade",
        expect.anything(),
      );
      expect(changeTierMock).toHaveBeenCalledWith("warlord");
      expect(startPurchaseMock).not.toHaveBeenCalled();
    });

    it("the tier already held is refused before any call, on either rail", async () => {
      subscribedOn("steam");
      await purchaseCosmetic(
        resolved({
          type: "subscription",
          cosmetic: { name: "vanguard", priceMonthly: 5 } as any,
          key: "subscription:vanguard",
        }),
        "dollar",
      );
      expect(startPurchaseMock).not.toHaveBeenCalled();
      expect(changeTierMock).not.toHaveBeenCalled();
      expect(alertMock).toHaveBeenCalledWith("store.already_subscribed");
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
