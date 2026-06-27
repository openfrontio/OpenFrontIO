import {
  CosmeticsSchema,
  EffectSchema,
  TransportShipTrailAttributesSchema,
} from "../src/core/CosmeticSchemas";

describe("Effect cosmetic schemas", () => {
  const base = { name: "spectrum", product: null, rarity: "common" };

  describe("TransportShipTrailAttributesSchema (lenient)", () => {
    it("parses the known attribute variants", () => {
      expect(
        TransportShipTrailAttributesSchema.safeParse({
          type: "solid",
          color: "#f00",
        }).success,
      ).toBe(true);
      expect(
        TransportShipTrailAttributesSchema.safeParse({ type: "rainbow" })
          .success,
      ).toBe(true);
      expect(
        TransportShipTrailAttributesSchema.safeParse({
          type: "pulse",
          color: "#0f0",
        }).success,
      ).toBe(true);
      expect(
        TransportShipTrailAttributesSchema.safeParse({
          type: "gradient",
          color: "#f00",
          color2: "#00f",
        }).success,
      ).toBe(true);
    });

    it("tolerates an unknown attribute type (ignored at render time)", () => {
      expect(
        TransportShipTrailAttributesSchema.safeParse({ type: "sparkle" })
          .success,
      ).toBe(true);
    });

    it("requires a `type`", () => {
      expect(TransportShipTrailAttributesSchema.safeParse({}).success).toBe(
        false,
      );
    });
  });

  describe("EffectSchema", () => {
    it("parses an effect (effectType is the catalog key, not a field)", () => {
      expect(
        EffectSchema.safeParse({ ...base, attributes: { type: "rainbow" } })
          .success,
      ).toBe(true);
    });

    it("rejects an effect with no attributes", () => {
      expect(EffectSchema.safeParse({ ...base }).success).toBe(false);
    });

    it("tolerates an effect with an unknown attribute type", () => {
      expect(
        EffectSchema.safeParse({ ...base, attributes: { type: "sparkle" } })
          .success,
      ).toBe(true);
    });
  });

  // Exact shape served by the production cosmetics.json: nested
  // effects[effectType][effectName], no `effectType` field on the effect, and
  // extras (e.g. product.priceInCents) stripped.
  it("parses the real nested cosmetics.json effects", () => {
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        transportShipTrail: {
          rainbow_ship: {
            name: "rainbow_ship",
            attributes: { type: "rainbow" },
            affiliateCode: null,
            product: null,
            priceHard: 123,
            rarity: "common",
          },
          gradient: {
            name: "gradient",
            attributes: {
              type: "gradient",
              color: "#aea2a2",
              color2: "#a80000",
            },
            affiliateCode: null,
            product: {
              price: "$0.99",
              priceInCents: 99,
              productId: "prod_x",
              priceId: "price_x",
            },
            rarity: "common",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.effects?.transportShipTrail?.rainbow_ship?.attributes?.type,
      ).toBe("rainbow");
    }
  });

  it("tolerates an unknown effectType (outer key) without failing the parse", () => {
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        transportShipTrail: {
          ship: {
            name: "ship",
            attributes: { type: "solid", color: "#fff" },
            product: null,
            rarity: "common",
          },
        },
        someFutureEffect: {
          thing: {
            name: "thing",
            attributes: { type: "whatever" },
            product: null,
            rarity: "common",
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
