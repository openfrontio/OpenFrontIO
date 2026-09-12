import fs from "fs";
import IntlMessageFormat from "intl-messageformat";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OPE-440. Every Steam base-app buyer gets a GRANTED month: a subscription row
// with `provider: null`, which nobody is billing. Until this fix that cohort
// could not pay us at all — the tier they held rendered a dead "Subscribed"
// box with no button, and every other tier routed to `change-tier`, which the
// server answers 400 ("Cannot change tier of a granted subscription") because
// there is no agreement to reprice.
//
// The regression guard matters as much as the fix: a change that sent
// EVERYONE to checkout would break Stripe's in-place reprice and still pass a
// granted-only test, so the paid paths are asserted here too.

vi.mock("../../src/client/Api", () => ({
  changeSubscriptionTier: vi.fn(),
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
  getUserMe,
  invalidateUserMe,
} from "../../src/client/Api";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import {
  invalidateCosmetics,
  purchaseCosmetic,
  resolveCosmetics,
} from "../../src/client/Cosmetics";
import {
  showInGameAlert,
  showInGameConfirm,
} from "../../src/client/InGameModal";
import { startPurchase } from "../../src/client/Payments";
import { translateText } from "../../src/client/Utils";
import type { Cosmetics, Subscription } from "../../src/core/CosmeticSchemas";

const startPurchaseMock = startPurchase as unknown as ReturnType<typeof vi.fn>;
const alertMock = showInGameAlert as unknown as ReturnType<typeof vi.fn>;
const confirmMock = showInGameConfirm as unknown as ReturnType<typeof vi.fn>;
const getUserMeMock = getUserMe as unknown as ReturnType<typeof vi.fn>;
const translateTextMock = translateText as unknown as ReturnType<typeof vi.fn>;
const changeTierMock = changeSubscriptionTier as unknown as ReturnType<
  typeof vi.fn
>;

const DAY_MS = 86_400_000;

/**
 * The catalog `fetchCosmetics` would otherwise go to the network for.
 *
 * `fetchCosmetics` is called from inside the module under test, so it cannot
 * be swapped out with vi.mock the way the imported collaborators above are —
 * the seam is `fetch` itself. Left unstubbed the change-tier path issues a
 * real request for https://api.test/cosmetics.json: it fails fast in jsdom
 * today and the error is swallowed, so it looks harmless, but it is one DNS
 * timeout away from a slow or flaky CI job that would not obviously be this
 * file's fault.
 *
 * Schema-VALID, deliberately, rather than any old object: a payload that
 * fails CosmeticsSchema makes fetchCosmetics return null, and a null current
 * cosmetic silently defaults the confirm to "upgrade". The downgrade test
 * below is what proves this catalog is really being read.
 */
function subscription(name: string, priceMonthly: number) {
  return {
    name,
    product: {
      productId: name,
      priceId: `price_${name}`,
      price: `$${priceMonthly}`,
    },
    rarity: "legendary",
    description: name,
    priceMonthly,
    dailySoftCurrency: 0,
    dailyHardCurrency: 10,
    hardCurrencySignupBonus: 100,
    unlimitedRanked: true,
    canCreatePublicLobbies: true,
  };
}

const CATALOG = {
  patterns: {},
  flags: {},
  subscriptions: {
    gold: subscription("gold", 5),
    platinum: subscription("platinum", 10),
  },
};

vi.stubGlobal("fetch", vi.fn());
const fetchMock = () => global.fetch as unknown as ReturnType<typeof vi.fn>;

function tier(name: string, priceMonthly: number): ResolvedCosmetic {
  return {
    type: "subscription",
    cosmetic: { name, priceMonthly } as unknown as Subscription,
    colorPalette: null,
    relationship: "purchasable",
    key: `subscription:${name}`,
  } as ResolvedCosmetic;
}

/**
 * `provider` is deliberately three-state, so every case is spelled out rather
 * than defaulted:
 *   null      — granted (the Steam base-app free month, or an admin comp).
 *   "stripe" / "steam" — paid.
 *   undefined — a server that predates the field; we cannot tell, so the
 *               client must keep the PAID behaviour.
 */
function signedInWith(subscription: {
  tier: string;
  provider: string | null | undefined;
  currentPeriodEnd?: Date | null;
}) {
  getUserMeMock.mockResolvedValue({
    player: {
      subscription: {
        tier: subscription.tier,
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: subscription.currentPeriodEnd ?? null,
        ...("provider" in subscription
          ? { provider: subscription.provider }
          : {}),
      },
    },
  });
}

/** The params the confirm dialog's message was built from. */
function confirmCall(): [string, Record<string, unknown> | undefined] {
  const call = translateTextMock.mock.calls.find(
    (args: unknown[]) =>
      typeof args[0] === "string" &&
      (args[0] as string).startsWith("store.confirm_subscribe_over_grant"),
  );
  expect(call, "no confirm string was built").toBeDefined();
  return call as [string, Record<string, unknown> | undefined];
}

beforeEach(() => {
  vi.clearAllMocks();
  startPurchaseMock.mockResolvedValue({ outcome: "redirecting" });
  confirmMock.mockResolvedValue(true);
  translateTextMock.mockImplementation((key: string) => key);
  fetchMock().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => CATALOG,
  });
  // fetchCosmetics memoizes its promise for the life of the module, so
  // without this only the first test to reach it would exercise the stub.
  invalidateCosmetics();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("purchaseCosmetic: a granted subscriber reaches checkout", () => {
  it("buys the tier the grant already confers, instead of refusing it", async () => {
    // The single likeliest conversion in the cohort, and the one the old
    // `already_subscribed` guard refused outright.
    signedInWith({ tier: "gold", provider: null });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    expect(startPurchaseMock).toHaveBeenCalledWith({
      kind: "subscription_tier",
      tierName: "gold",
    });
    expect(changeTierMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalledWith("store.already_subscribed");
  });

  it("buys a different tier through checkout, never change-tier", async () => {
    // change-tier is a 400 for a grant ("Cannot change tier of a granted
    // subscription"), which the client surfaced as "Couldn't update your
    // subscription".
    signedInWith({ tier: "gold", provider: null });

    await purchaseCosmetic(tier("platinum", 10), "dollar");

    expect(startPurchaseMock).toHaveBeenCalledWith({
      kind: "subscription_tier",
      tierName: "platinum",
    });
    expect(changeTierMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalledWith("store.change_tier_failed");
  });

  it("does not need a rail on the account: a grant has none, the device decides", async () => {
    // No Steam shell installed, so paymentsProvider() is Stripe. A granted
    // player on the web is admitted by /payments/checkout just as one in the
    // desktop shell is, so there is nothing here to refuse.
    signedInWith({ tier: "gold", provider: null });

    await purchaseCosmetic(tier("platinum", 10), "dollar");

    expect(alertMock).not.toHaveBeenCalledWith(
      "store.tier_change_steam_needs_desktop",
    );
    expect(alertMock).not.toHaveBeenCalledWith(
      "store.tier_change_unavailable_steam",
    );
    expect(startPurchaseMock).toHaveBeenCalled();
  });

  it("buys nothing when the player dismisses the confirm", async () => {
    signedInWith({
      tier: "gold",
      provider: null,
      currentPeriodEnd: new Date(Date.now() + 12 * DAY_MS),
    });
    confirmMock.mockResolvedValue(false);

    await purchaseCosmetic(tier("gold", 5), "dollar");

    // Asserted, not assumed: without it this test also passes on the broken
    // build, where the same click is refused before any dialog is shown.
    expect(confirmMock).toHaveBeenCalledWith(
      "store.confirm_subscribe_over_grant",
      expect.anything(),
    );
    expect(startPurchaseMock).not.toHaveBeenCalled();
    expect(changeTierMock).not.toHaveBeenCalled();
  });

  it("reports the checkout outcome with the first-purchase success line", async () => {
    signedInWith({ tier: "gold", provider: null });
    startPurchaseMock.mockResolvedValue({ outcome: "completed" });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    // Not change_tier_success: nothing was switched, a subscription started.
    expect(alertMock).toHaveBeenCalledWith(
      "store.subscription_purchase_success",
    );
  });

  it("refreshes the profile after a completed purchase, so the store stops offering it", async () => {
    // The Steam overlay path never navigates, so an open StoreModal keeps the
    // profile it rendered from: without this refresh the tier the player has
    // just bought goes on showing a buy button. That is the flow this entire
    // cohort is in, so it is asserted rather than assumed.
    signedInWith({ tier: "gold", provider: null });
    startPurchaseMock.mockResolvedValue({ outcome: "completed" });
    const broadcast = vi.fn();
    document.addEventListener("userMeResponse", broadcast);

    try {
      await purchaseCosmetic(tier("gold", 5), "dollar");
    } finally {
      document.removeEventListener("userMeResponse", broadcast);
    }

    expect(invalidateUserMe).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalled();
  });

  it("does not refresh the profile when the purchase only redirected", async () => {
    // Nothing has settled yet, and the page is going away regardless.
    signedInWith({ tier: "gold", provider: null });
    startPurchaseMock.mockResolvedValue({ outcome: "redirecting" });
    const broadcast = vi.fn();
    document.addEventListener("userMeResponse", broadcast);

    try {
      await purchaseCosmetic(tier("gold", 5), "dollar");
    } finally {
      document.removeEventListener("userMeResponse", broadcast);
    }

    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe("purchaseCosmetic: the confirm a granted subscriber is shown", () => {
  it("is not the tier-change copy, which promises proration that does not happen", async () => {
    signedInWith({
      tier: "gold",
      provider: null,
      currentPeriodEnd: new Date(Date.now() + 12 * DAY_MS),
    });

    await purchaseCosmetic(tier("platinum", 10), "dollar");

    const shown = confirmMock.mock.calls[0][0];
    expect(shown).not.toBe("store.confirm_upgrade");
    expect(shown).not.toBe("store.confirm_downgrade");
    expect(shown).not.toBe("store.confirm_tier_change_steam");
    expect(shown).toBe("store.confirm_subscribe_over_grant");
    // Something the player can regret: infra expires the grant outright in
    // the same transaction as the paid insert.
    expect(confirmMock.mock.calls[0][1]).toMatchObject({
      variant: "warning",
      // Not "Change Tier": nothing is being changed, a subscription starts.
      heading: "store.subscribe_heading",
    });
  });

  it("names the free days that are about to be forfeited", async () => {
    signedInWith({
      tier: "gold",
      provider: null,
      currentPeriodEnd: new Date(Date.now() + 12 * DAY_MS),
    });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    const [key, params] = confirmCall();
    expect(key).toBe("store.confirm_subscribe_over_grant");
    expect(params).toMatchObject({ days: 12 });
  });

  it("says 1 day, not 0, on the last day of the grant", async () => {
    // Twelve hours left. The singular is the case a player converting near
    // the end of their month actually sees.
    signedInWith({
      tier: "gold",
      provider: null,
      currentPeriodEnd: new Date(Date.now() + DAY_MS / 2),
    });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    expect(confirmCall()[1]).toMatchObject({ days: 1 });
  });

  it("rounds the count up, so it never understates what is lost", async () => {
    // Two hours into a 30-day grant. Flooring would say "29 days".
    signedInWith({
      tier: "gold",
      provider: null,
      currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS - 2 * 3_600_000),
    });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    expect(confirmCall()[1]).toMatchObject({ days: 30 });
  });

  it("quotes no number for an open-ended grant, rather than inventing one", async () => {
    // An admin comp has no end date at all; only the Steam ownership grant is
    // a fixed month.
    signedInWith({ tier: "gold", provider: null, currentPeriodEnd: null });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    const [key, params] = confirmCall();
    expect(key).toBe("store.confirm_subscribe_over_grant_no_days");
    expect(params).not.toHaveProperty("days");
  });

  it("quotes no number for a grant whose end date has already passed", async () => {
    signedInWith({
      tier: "gold",
      provider: null,
      currentPeriodEnd: new Date(Date.now() - DAY_MS),
    });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    expect(confirmCall()[0]).toBe("store.confirm_subscribe_over_grant_no_days");
  });
});

describe("purchaseCosmetic: paid subscribers are untouched", () => {
  it("a Stripe subscriber still reprices in place", async () => {
    // The guard against a fix that routes EVERYONE to checkout.
    signedInWith({ tier: "gold", provider: "stripe" });
    changeTierMock.mockResolvedValue(true);

    await purchaseCosmetic(tier("platinum", 10), "dollar");

    expect(changeTierMock).toHaveBeenCalledWith("platinum");
    expect(startPurchaseMock).not.toHaveBeenCalled();
  });

  it("an old server's `undefined` provider is treated as PAID, not granted", async () => {
    // `provider` is on main but not yet everywhere. Reading undefined as a
    // grant would send a paying Stripe subscriber to a second checkout.
    signedInWith({ tier: "gold", provider: undefined });
    changeTierMock.mockResolvedValue(true);

    await purchaseCosmetic(tier("platinum", 10), "dollar");

    expect(changeTierMock).toHaveBeenCalledWith("platinum");
    expect(startPurchaseMock).not.toHaveBeenCalled();
  });

  it("still reads the catalog: a cheaper tier confirms as a downgrade", async () => {
    // Only reachable when the catalog parsed. A fetch that fails — which is
    // what a real, unstubbed request does here — leaves the current cosmetic
    // null, and the confirm defaults to "upgrade" for every tier.
    signedInWith({ tier: "platinum", provider: "stripe" });
    changeTierMock.mockResolvedValue(true);

    await purchaseCosmetic(tier("gold", 5), "dollar");

    expect(confirmMock).toHaveBeenCalledWith(
      "store.confirm_downgrade",
      expect.anything(),
    );
  });

  it("still refuses the tier a paid subscriber already holds", async () => {
    signedInWith({ tier: "gold", provider: "stripe" });

    await purchaseCosmetic(tier("gold", 5), "dollar");

    expect(alertMock).toHaveBeenCalledWith("store.already_subscribed");
    expect(startPurchaseMock).not.toHaveBeenCalled();
    expect(changeTierMock).not.toHaveBeenCalled();
  });
});

describe("resolveCosmetics: the granted tier is for sale, not owned", () => {
  const catalog = {
    patterns: {},
    flags: {},
    colorPalettes: {},
    subscriptions: {
      gold: {
        name: "gold",
        priceMonthly: 5,
        product: { productId: "gold", priceId: "p_gold", price: "$5" },
      },
      platinum: {
        name: "platinum",
        priceMonthly: 10,
        product: { productId: "plat", priceId: "p_plat", price: "$10" },
      },
    },
  } as unknown as Cosmetics;

  function userMe(
    subscription: Record<string, unknown> | null,
    flares: string[] = [],
  ) {
    return { player: { subscription, flares } } as never;
  }

  function relationshipOf(user: unknown, key: string) {
    return resolveCosmetics(catalog, user as never, null).find(
      (item) => item.key === key,
    )?.relationship;
  }

  it("marks a granted tier purchasable so the store renders a buy button", () => {
    const user = userMe({ tier: "gold", status: "active", provider: null });
    expect(relationshipOf(user, "subscription:gold")).toBe("purchasable");
  });

  it("still marks a paid tier owned", () => {
    const user = userMe({ tier: "gold", status: "active", provider: "stripe" });
    expect(relationshipOf(user, "subscription:gold")).toBe("owned");
  });

  it("treats an old server's missing provider as owned", () => {
    const user = userMe({ tier: "gold", status: "active" });
    expect(relationshipOf(user, "subscription:gold")).toBe("owned");
  });

  it("leaves a flare-granted tier owned even while a grant is running", () => {
    // A flare is a permanent unlock, not a month; there is nothing to sell.
    const user = userMe({ tier: "gold", status: "active", provider: null }, [
      "subscription:platinum",
    ]);
    expect(relationshipOf(user, "subscription:platinum")).toBe("owned");
  });

  it("keeps a granted tier we cannot price owned, so its card does not vanish", () => {
    // Demoting a grant to "purchasable" is only safe while the tier HAS a
    // Stripe product to price the button from. Without one it would fall to
    // "blocked", and the subscriptions tab lists purchasable and owned only —
    // so the card would disappear entirely, which is worse than the dead
    // "Subscribed" box. OPE-441 is the real fix for the product gate.
    const unpriced = {
      patterns: {},
      flags: {},
      colorPalettes: {},
      subscriptions: {
        gold: { name: "gold", priceMonthly: 5, product: null },
      },
    } as unknown as Cosmetics;
    const user = userMe({ tier: "gold", status: "active", provider: null });

    const gold = resolveCosmetics(unpriced, user as never, null).find(
      (item) => item.key === "subscription:gold",
    );

    expect(gold?.relationship).toBe("owned");
  });
});

// The grammar lives in en.json, not in the code that picks the key, so these
// format the real strings. A test that only asserted `days: 1` was passed
// would not have caught "the 1 day left on it ARE not refunded".
describe("the granted-purchase confirm strings read correctly", () => {
  const store = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "..", "resources", "lang", "en.json"),
      "utf8",
    ),
  ).store as Record<string, string>;

  const render = (key: string, params: Record<string, unknown>) =>
    new IntlMessageFormat(store[key], "en").format(params) as string;

  it("agrees in number when a single day is left", () => {
    expect(
      render("confirm_subscribe_over_grant", { tier: "Gold", days: 1 }),
    ).toContain("the 1 day left on it is not refunded");
  });

  it("agrees in number for more than one day", () => {
    expect(
      render("confirm_subscribe_over_grant", { tier: "Gold", days: 28 }),
    ).toContain("the 28 days left on it are not refunded");
  });

  it("never calls a grant a month: an admin comp is open-ended", () => {
    // Only the Steam ownership grant is a fixed month. `currentPeriodEnd`
    // being set does not make a grant one, so neither string may say so.
    expect(
      render("confirm_subscribe_over_grant", { tier: "Gold", days: 3 }),
    ).not.toContain("free month");
    expect(
      render("confirm_subscribe_over_grant_no_days", { tier: "Gold" }),
    ).not.toContain("free month");
  });
});
