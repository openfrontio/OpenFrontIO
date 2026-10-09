import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCosmetics,
  invalidateCosmetics,
  resolveCosmetics,
  tierListingRail,
  withHeldTier,
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
  subscriptions: { steam_plus: tier("steam_plus", 4.99) },
};
const webListing = {
  patterns: {},
  flags: {},
  subscriptions: {
    vanguard: tier("vanguard", 4.99),
    warlord: tier("warlord", 9.99),
  },
};

function userMe(subTier: string | null, provider: string | null = "steam") {
  return {
    user: {},
    player: {
      publicId: "p",
      flares: [],
      steamLicence: true,
      noticesSeen: [],
      subscription:
        subTier === null
          ? null
          : {
              tier: subTier,
              status: "active",
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
              provider,
            },
    },
  } as unknown as UserMeResponse;
}

describe("subscription tier listing per rail", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidateCosmetics();
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("rail=steam") ? steamListing : webListing,
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    invalidateCosmetics();
    vi.unstubAllGlobals();
    delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
  });

  function onSteamBuild() {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
      steam: {},
    };
  }

  it("asks for the rail this device checks out on", async () => {
    expect(tierListingRail()).toBe("web");
    await fetchCosmetics();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.test/cosmetics.json?rail=web",
    );

    invalidateCosmetics();
    onSteamBuild();
    expect(tierListingRail()).toBe("steam");
    await fetchCosmetics();
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.test/cosmetics.json?rail=steam",
    );
  });

  it("renders Steam Plus alone when it is all the Steam rail lists", async () => {
    onSteamBuild();
    const me = userMe(null);
    const cosmetics = await withHeldTier(await fetchCosmetics(), me);
    const tiers = resolveCosmetics(cosmetics, me, null).filter(
      (r) => r.type === "subscription",
    );
    expect(tiers.map((r) => [r.key, r.relationship])).toEqual([
      ["subscription:steam_plus", "purchasable"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders a held tier the rail does not list, as owned only", async () => {
    onSteamBuild();
    const me = userMe("warlord");
    const cosmetics = await withHeldTier(await fetchCosmetics(), me);
    const tiers = resolveCosmetics(cosmetics, me, null).filter(
      (r) => r.type === "subscription",
    );
    expect(tiers.map((r) => [r.key, r.relationship])).toEqual([
      ["subscription:steam_plus", "purchasable"],
      ["subscription:warlord", "owned"],
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.test/cosmetics.json?rail=web",
    );
  });

  it("does not fetch again when the held tier is listed", async () => {
    const me = userMe("vanguard", "stripe");
    const cosmetics = await fetchCosmetics();
    expect(await withHeldTier(cosmetics, me)).toBe(cosmetics);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
