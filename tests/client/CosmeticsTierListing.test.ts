import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCosmetics,
  invalidateCosmetics,
  resolveCosmetics,
  subscriptionTier,
  tierListingRail,
} from "../../src/client/Cosmetics";

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getApiBase: () => "https://api.test",
}));

function tier(name: string, priceMonthly: number) {
  return {
    name,
    affiliateCode: null,
    product: {
      price: `$${priceMonthly}`,
      priceInCents: priceMonthly * 100,
      productId: `prod_${name}`,
      priceId: `price_${name}`,
    },
    rarity: "epic",
    description: name,
    priceMonthly,
    dailySoftCurrency: 0,
    dailyHardCurrency: 10,
    hardCurrencySignupBonus: 250,
    canCreatePublicLobbies: false,
  };
}

const steamListing = {
  patterns: {},
  flags: {},
  subscriptions: {
    steam_plus: { ...tier("steam_plus", 4.99), requiresSteamLicence: true },
  },
  unlistedSubscriptions: {
    warlord: tier("warlord", 9.99),
    sovereign: tier("sovereign", 19.99),
  },
};

function userMe(subTier: string | null) {
  return {
    user: {},
    steamLicence: true,
    noticesSeen: [],
    player: {
      publicId: "p",
      flares: [],
      subscription:
        subTier === null
          ? null
          : {
              tier: subTier,
              status: "active",
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              provider: "steam",
            },
    },
  } as unknown as UserMeResponse;
}

function subscriptionTiles(me: UserMeResponse, cosmetics: unknown) {
  return resolveCosmetics(cosmetics as never, me, null)
    .filter((r) => r.type === "subscription")
    .map((r) => [r.key, r.relationship]);
}

describe("subscription tier listing per rail", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateCosmetics();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => steamListing,
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    invalidateCosmetics();
    vi.unstubAllGlobals();
    delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
  });

  it("asks for the rail this device checks out on", async () => {
    expect(tierListingRail()).toBe("web");
    await fetchCosmetics();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.test/cosmetics.json?rail=web",
    );

    invalidateCosmetics();
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      steam: {},
    };
    expect(tierListingRail()).toBe("steam");
    await fetchCosmetics();
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.test/cosmetics.json?rail=steam",
    );
  });

  it("renders Steam Plus alone when it is all the rail lists", async () => {
    const cosmetics = await fetchCosmetics();
    expect(cosmetics?.subscriptions?.steam_plus.requiresSteamLicence).toBe(
      true,
    );
    expect(subscriptionTiles(userMe(null), cosmetics)).toEqual([
      ["subscription:steam_plus", "purchasable"],
    ]);
  });

  it("renders the player's own unlisted tier as owned, and no other unlisted tier", async () => {
    const cosmetics = await fetchCosmetics();
    expect(subscriptionTiles(userMe("warlord"), cosmetics)).toEqual([
      ["subscription:steam_plus", "purchasable"],
      ["subscription:warlord", "owned"],
    ]);
  });

  it("sells a listed tier that has no Stripe product", async () => {
    const steamOnly = {
      ...steamListing,
      subscriptions: {
        steam_plus: { ...steamListing.subscriptions.steam_plus, product: null },
      },
    };
    expect(subscriptionTiles(userMe(null), steamOnly)).toEqual([
      ["subscription:steam_plus", "purchasable"],
    ]);
  });

  it("never sells an unlisted tier, even one with a Stripe product", async () => {
    const cosmetics = await fetchCosmetics();
    expect(cosmetics?.unlistedSubscriptions?.sovereign.product).not.toBeNull();
    expect(subscriptionTiles(userMe("sovereign"), cosmetics)).toEqual([
      ["subscription:steam_plus", "purchasable"],
      ["subscription:sovereign", "owned"],
    ]);
  });

  it("looks a tier up whether or not the rail lists it", async () => {
    const cosmetics = await fetchCosmetics();
    expect(subscriptionTier(cosmetics, "steam_plus")?.name).toBe("steam_plus");
    expect(subscriptionTier(cosmetics, "warlord")?.name).toBe("warlord");
    expect(subscriptionTier(cosmetics, "missing")).toBeNull();
  });

  it("defaults requiresSteamLicence for an older API", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        patterns: {},
        flags: {},
        subscriptions: { vanguard: tier("vanguard", 4.99) },
      }),
    });
    const cosmetics = await fetchCosmetics();
    expect(cosmetics?.subscriptions?.vanguard.requiresSteamLicence).toBe(false);
    expect(cosmetics?.unlistedSubscriptions).toBeUndefined();
  });
});
