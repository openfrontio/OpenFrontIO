import {
  CosmeticsSchema,
  EffectSchema,
  TransportShipTrailAttributesSchema,
} from "../src/core/CosmeticSchemas";

describe("Effect cosmetic schemas", () => {
  const base = { name: "spectrum", product: null, rarity: "legendary" };

  describe("TransportShipTrailAttributesSchema", () => {
    it("parses each attribute variant", () => {
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

    it("rejects an unknown attribute type", () => {
      expect(
        TransportShipTrailAttributesSchema.safeParse({ type: "sparkle" })
          .success,
      ).toBe(false);
    });

    it("requires color for solid/pulse and both colors for gradient", () => {
      expect(
        TransportShipTrailAttributesSchema.safeParse({ type: "solid" }).success,
      ).toBe(false);
      expect(
        TransportShipTrailAttributesSchema.safeParse({
          type: "gradient",
          color: "#f00",
        }).success,
      ).toBe(false);
    });
  });

  describe("EffectSchema", () => {
    it("discriminates an effect on effectType", () => {
      expect(
        EffectSchema.safeParse({
          ...base,
          effectType: "transportShipTrail",
          attributes: { type: "rainbow" },
        }).success,
      ).toBe(true);
    });

    it("rejects an unknown effectType", () => {
      expect(
        EffectSchema.safeParse({
          ...base,
          effectType: "explosion",
          attributes: { type: "rainbow" },
        }).success,
      ).toBe(false);
    });

    it("rejects a transportShipTrail effect with no attributes", () => {
      expect(
        EffectSchema.safeParse({ ...base, effectType: "transportShipTrail" })
          .success,
      ).toBe(false);
    });
  });

  // Exact shape served by the production cosmetics.json (incl. the `url` field
  // and stripped extras like `description`) — guards against schema drift.
  it("parses the real cosmetics.json effect entry", () => {
    const realEffect = {
      name: "read_transport_trail",
      effectType: "transportShipTrail",
      attributes: { type: "solid", color: "#f91515" },
      url: "",
      affiliateCode: null,
      product: null,
      rarity: "common",
    };
    expect(EffectSchema.safeParse(realEffect).success).toBe(true);

    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: { read_transport_trail: realEffect },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.effects?.read_transport_trail.effectType).toBe(
        "transportShipTrail",
      );
    }
  });
});
