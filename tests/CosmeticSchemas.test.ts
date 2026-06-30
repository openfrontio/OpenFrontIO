import {
  Cosmetics,
  CosmeticsSchema,
  EffectSchema,
  findEffect,
  TransportShipTrailAttributesSchema,
} from "../src/core/CosmeticSchemas";
import { PlayerEffectSchema } from "../src/core/Schemas";

describe("Effect cosmetic schemas", () => {
  const base = {
    name: "spectrum",
    effectType: "transportShipTrail",
    product: null,
    rarity: "common",
  };

  describe("TransportShipTrailAttributesSchema", () => {
    it("parses a gradient with a color list, colorSize, and movementSpeed", () => {
      const parsed = TransportShipTrailAttributesSchema.parse({
        type: "gradient",
        colors: ["#f00", "#00f"],
        colorSize: 16,
        movementSpeed: 0.15,
      });
      expect(parsed).toEqual({
        type: "gradient",
        colors: ["#f00", "#00f"],
        colorSize: 16,
        movementSpeed: 0.15,
      });
    });

    it("accepts a single-color list (solid) and an empty list", () => {
      expect(
        TransportShipTrailAttributesSchema.safeParse({
          type: "gradient",
          colors: ["#f00"],
          colorSize: 16,
          movementSpeed: 0.15,
        }).success,
      ).toBe(true);
      expect(
        TransportShipTrailAttributesSchema.safeParse({
          type: "gradient",
          colors: [],
          colorSize: 16,
          movementSpeed: 0.15,
        }).success,
      ).toBe(true);
    });

    it("requires the gradient type, colors, colorSize, and movementSpeed", () => {
      // The old solid/rainbow/pulse styles are gone — only gradient remains.
      expect(
        TransportShipTrailAttributesSchema.safeParse({ type: "solid" }).success,
      ).toBe(false);
      // colors, colorSize, and movementSpeed are all required.
      expect(
        TransportShipTrailAttributesSchema.safeParse({
          type: "gradient",
          colors: ["#f00"],
        }).success,
      ).toBe(false);
      expect(TransportShipTrailAttributesSchema.safeParse({}).success).toBe(
        false,
      );
    });
  });

  describe("EffectSchema", () => {
    it("parses an effect (discriminated on effectType)", () => {
      expect(
        EffectSchema.safeParse({
          ...base,
          attributes: {
            type: "gradient",
            colors: ["#f00", "#0f0", "#00f"],
            colorSize: 16,
            movementSpeed: 0.15,
          },
        }).success,
      ).toBe(true);
    });

    it("rejects an effect with no attributes", () => {
      expect(EffectSchema.safeParse({ ...base }).success).toBe(false);
    });

    it("rejects an effect with an unknown effectType (no union member)", () => {
      expect(
        EffectSchema.safeParse({
          ...base,
          effectType: "glow",
          attributes: {
            type: "gradient",
            colors: ["#f00"],
            colorSize: 16,
            movementSpeed: 0.15,
          },
        }).success,
      ).toBe(false);
    });

    it("rejects an effect with a non-gradient attribute type", () => {
      expect(
        EffectSchema.safeParse({
          ...base,
          attributes: { type: "sparkle" },
        }).success,
      ).toBe(false);
    });
  });

  // Exact shape served by the production cosmetics.json: nested
  // effects[effectType][effectName], each effect carrying its effectType, and
  // extras (e.g. product.priceInCents) stripped.
  it("parses the real nested cosmetics.json effects", () => {
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        transportShipTrail: {
          rainbow_ship: {
            name: "rainbow_ship",
            effectType: "transportShipTrail",
            attributes: {
              type: "gradient",
              colors: ["#ff0000", "#ffe600", "#00a8ff", "#7d5fff"],
              colorSize: 24,
              movementSpeed: 0.2,
            },
            affiliateCode: null,
            product: null,
            priceHard: 123,
            rarity: "common",
          },
          gradient: {
            name: "gradient",
            effectType: "transportShipTrail",
            attributes: {
              type: "gradient",
              colors: ["#aea2a2", "#a80000"],
              colorSize: 16,
              movementSpeed: 0.15,
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
        result.data.effects?.transportShipTrail?.rainbow_ship?.attributes
          ?.colors,
      ).toEqual(["#ff0000", "#ffe600", "#00a8ff", "#7d5fff"]);
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
            effectType: "transportShipTrail",
            attributes: {
              type: "gradient",
              colors: ["#fff"],
              colorSize: 16,
              movementSpeed: 0.15,
            },
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

describe("findEffect", () => {
  const effect = (name: string) => ({
    name,
    attributes: {
      type: "gradient",
      colors: ["#fff"],
      colorSize: 16,
      movementSpeed: 0.15,
    } as const,
    product: null,
    rarity: "common" as const,
  });

  it("resolves by the catalog object key (the common key === name case)", () => {
    const cosmetics = {
      effects: { transportShipTrail: { spectrum: effect("spectrum") } },
    } as unknown as Cosmetics;
    expect(findEffect(cosmetics, "transportShipTrail", "spectrum")?.name).toBe(
      "spectrum",
    );
  });

  it("falls back to the name field when the object key differs", () => {
    // Catalog key "trail_01" but the effect's name is "spectrum"; selection and
    // flares are name-based, so the name must still resolve the effect.
    const cosmetics = {
      effects: { transportShipTrail: { trail_01: effect("spectrum") } },
    } as unknown as Cosmetics;
    expect(findEffect(cosmetics, "transportShipTrail", "spectrum")?.name).toBe(
      "spectrum",
    );
  });

  it("returns undefined for an unknown effect name", () => {
    const cosmetics = {
      effects: { transportShipTrail: { spectrum: effect("spectrum") } },
    } as unknown as Cosmetics;
    expect(
      findEffect(cosmetics, "transportShipTrail", "ghost"),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown effectType or missing catalog", () => {
    const cosmetics = {
      effects: { transportShipTrail: { spectrum: effect("spectrum") } },
    } as unknown as Cosmetics;
    expect(findEffect(cosmetics, "wrongType", "spectrum")).toBeUndefined();
    expect(findEffect(null, "transportShipTrail", "spectrum")).toBeUndefined();
    expect(
      findEffect({} as Cosmetics, "transportShipTrail", "x"),
    ).toBeUndefined();
  });
});

describe("PlayerEffectSchema (identity: name + effectType)", () => {
  it("parses a name + effectType (attributes live in the catalog)", () => {
    expect(
      PlayerEffectSchema.safeParse({
        name: "spectrum",
        effectType: "transportShipTrail",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown effectType (not in EFFECT_TYPES)", () => {
    expect(
      PlayerEffectSchema.safeParse({
        name: "spectrum",
        effectType: "glow",
      }).success,
    ).toBe(false);
  });

  it("requires an effectType", () => {
    expect(PlayerEffectSchema.safeParse({ name: "spectrum" }).success).toBe(
      false,
    );
  });
});
