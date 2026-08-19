import { cosmeticRelationship } from "../src/client/Cosmetics";
import { UserMeResponse } from "../src/core/ApiSchemas";

function makeUserMe(flares: string[]): UserMeResponse {
  return {
    player: { flares },
  } as unknown as UserMeResponse;
}

describe("cosmeticRelationship", () => {
  it("returns owned when user has wildcard flare", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["flag:*"]),
      ),
    ).toBe("owned");
  });

  it("returns owned when user has the specific flare", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["flag:cool"]),
      ),
    ).toBe("owned");
  });

  it("returns blocked when no currency price and user does not own it", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe([]),
      ),
    ).toBe("blocked");
  });

  it("returns blocked when affiliate codes do not match", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: 50,
          affiliateCode: "storeA",
          itemAffiliateCode: "storeB",
        },
        makeUserMe([]),
      ),
    ).toBe("blocked");
  });

  it("returns purchasable when currency price exists and affiliate matches", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: 50,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe([]),
      ),
    ).toBe("purchasable");
  });

  it("returns purchasable when affiliate codes match", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "pattern:*",
          requiredFlare: "pattern:stripes:red",
          priceSoft: undefined,
          priceHard: 50,
          affiliateCode: "storeA",
          itemAffiliateCode: "storeA",
        },
        makeUserMe([]),
      ),
    ).toBe("purchasable");
  });

  it("returns blocked when user is not logged in and no currency price", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        false,
      ),
    ).toBe("blocked");
  });

  it("returns purchasable when user is not logged in but currency price exists", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: 50,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        false,
      ),
    ).toBe("purchasable");
  });

  it("returns purchasable when item has soft currency price", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: 100,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe([]),
      ),
    ).toBe("purchasable");
  });

  it("returns blocked when item has currency price but affiliate codes do not match", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: 100,
          priceHard: 50,
          affiliateCode: "storeA",
          itemAffiliateCode: "storeB",
        },
        makeUserMe([]),
      ),
    ).toBe("blocked");
  });

  it("returns owned when user has wildcard flare for patterns", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "pattern:*",
          requiredFlare: "pattern:stripes:red",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["pattern:*"]),
      ),
    ).toBe("owned");
  });
});
