import { cosmeticRelationship } from "../src/client/Cosmetics";
import { UserMeResponse } from "../src/core/ApiSchemas";

const product = { productId: "prod_123", priceId: "price_123", price: "$4.99" };

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
          product,
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
          product,
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["flag:cool"]),
      ),
    ).toBe("owned");
  });

  it("returns blocked when no product and user does not own it", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          product: null,
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
          product,
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: "storeA",
          itemAffiliateCode: "storeB",
        },
        makeUserMe([]),
      ),
    ).toBe("blocked");
  });

  it("returns purchasable when product exists and affiliate matches", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          product,
          priceSoft: undefined,
          priceHard: undefined,
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
          product,
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: "storeA",
          itemAffiliateCode: "storeA",
        },
        makeUserMe([]),
      ),
    ).toBe("purchasable");
  });

  it("returns blocked when user is not logged in and no product", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          product: null,
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        false,
      ),
    ).toBe("blocked");
  });

  it("returns purchasable when user is not logged in but product exists", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          product,
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        false,
      ),
    ).toBe("purchasable");
  });

  it("returns purchasable when item has currency price and no product", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          product: null,
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
          product: null,
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
          product,
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
