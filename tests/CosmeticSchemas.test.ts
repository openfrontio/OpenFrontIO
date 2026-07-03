import {
  Cosmetics,
  CosmeticsSchema,
  Effect,
  effectMatchesSlot,
  EffectSchema,
  effectTypeForSlot,
  findEffect,
  findEffectForSlot,
  isNukeExplosionEffect,
  isTrailEffect,
  NukeExplosionAttributesSchema,
  TrailEffectAttributesSchema,
} from "../src/core/CosmeticSchemas";
import { PlayerEffectSchema } from "../src/core/Schemas";

describe("Effect cosmetic schemas", () => {
  const base = {
    name: "spectrum",
    effectType: "transportShipTrail",
    product: null,
    rarity: "common",
  };

  describe("TrailEffectAttributesSchema", () => {
    it("parses a gradient with a color list, colorSize, and movementSpeed", () => {
      const parsed = TrailEffectAttributesSchema.parse({
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
        TrailEffectAttributesSchema.safeParse({
          type: "gradient",
          colors: ["#f00"],
          colorSize: 16,
          movementSpeed: 0.15,
        }).success,
      ).toBe(true);
      expect(
        TrailEffectAttributesSchema.safeParse({
          type: "gradient",
          colors: [],
          colorSize: 16,
          movementSpeed: 0.15,
        }).success,
      ).toBe(true);
    });

    it("requires the gradient type, colors, colorSize, and movementSpeed", () => {
      // Unrecognized styles (no discriminated-union member) are rejected.
      expect(
        TrailEffectAttributesSchema.safeParse({ type: "solid" }).success,
      ).toBe(false);
      // colors, colorSize, and movementSpeed are all required.
      expect(
        TrailEffectAttributesSchema.safeParse({
          type: "gradient",
          colors: ["#f00"],
        }).success,
      ).toBe(false);
      expect(TrailEffectAttributesSchema.safeParse({}).success).toBe(false);
    });

    it("parses a transition with a color list and frequency", () => {
      const parsed = TrailEffectAttributesSchema.parse({
        type: "transition",
        colors: ["#002aff", "#4805ff"],
        frequency: 1,
      });
      expect(parsed).toEqual({
        type: "transition",
        colors: ["#002aff", "#4805ff"],
        frequency: 1,
      });
    });

    it("requires frequency for a transition", () => {
      expect(
        TrailEffectAttributesSchema.safeParse({
          type: "transition",
          colors: ["#002aff", "#4805ff"],
        }).success,
      ).toBe(false);
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

    it("parses a nukeTrail effect (same attributes, different effectType)", () => {
      expect(
        EffectSchema.safeParse({
          ...base,
          name: "tiel_red_gradient_nuke_trail",
          effectType: "nukeTrail",
          attributes: {
            type: "gradient",
            colors: ["#ff0000", "#00ffb3"],
            colorSize: 0.5,
            movementSpeed: 2,
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
        nukeTrail: {
          tiel_red_gradient_nuke_trail: {
            name: "tiel_red_gradient_nuke_trail",
            effectType: "nukeTrail",
            attributes: {
              type: "gradient",
              colors: ["#ff0000", "#00ffb3"],
              colorSize: 0.5,
              movementSpeed: 2,
            },
            affiliateCode: null,
            product: null,
            priceHard: 1,
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
      expect(
        result.data.effects?.nukeTrail?.tiel_red_gradient_nuke_trail
          ?.effectType,
      ).toBe("nukeTrail");
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

  it("drops a newer-shaped effect within a known effectType without failing the catalog", () => {
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        transportShipTrail: {
          good: {
            name: "good",
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
          // A newer effect shape this client doesn't understand yet — must be
          // dropped, not fail the whole catalog parse.
          future: {
            name: "future",
            effectType: "transportShipTrail",
            attributes: { type: "hologram", intensity: 3 },
            product: null,
            rarity: "common",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const trails = result.data.effects?.transportShipTrail;
      // The good effect survives...
      expect(trails?.good?.name).toBe("good");
      // ...and only the unparseable newer one is dropped.
      expect(trails?.future).toBeUndefined();
    }
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

describe("NukeExplosionAttributesSchema", () => {
  const atomShockwave = {
    type: "shockwave",
    nukeType: "atom",
    colors: ["#ff0000", "#bb00ff"],
    size: 50,
    speed: 50,
    thickness: 4,
    transitionSpeed: 5,
  };

  it("parses the atom shockwave attributes", () => {
    expect(NukeExplosionAttributesSchema.safeParse(atomShockwave).success).toBe(
      true,
    );
  });

  it("parses all three nukeTypes (atom, hydro, mirvWarhead)", () => {
    for (const nukeType of ["atom", "hydro", "mirvWarhead"]) {
      expect(
        NukeExplosionAttributesSchema.safeParse({ ...atomShockwave, nukeType })
          .success,
      ).toBe(true);
    }
  });

  it("parses both visual types (shockwave, sparkles)", () => {
    expect(NukeExplosionAttributesSchema.safeParse(atomShockwave).success).toBe(
      true,
    );
    expect(
      NukeExplosionAttributesSchema.safeParse({
        ...atomShockwave,
        type: "sparkles",
        density: 150,
      }).success,
    ).toBe(true);
  });

  it("sparkles require a positive density", () => {
    for (const density of [undefined, 0, -50]) {
      expect(
        NukeExplosionAttributesSchema.safeParse({
          ...atomShockwave,
          type: "sparkles",
          density,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects an unknown nukeType or type (so it's dropped, not rendered wrong)", () => {
    expect(
      NukeExplosionAttributesSchema.safeParse({
        ...atomShockwave,
        nukeType: "hydrogen",
      }).success,
    ).toBe(false);
    expect(
      NukeExplosionAttributesSchema.safeParse({
        ...atomShockwave,
        type: "fireball",
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive size and thickness (dropped, not rendered wrong)", () => {
    for (const patch of [
      { size: 0 },
      { size: -50 },
      { thickness: 0 },
      { thickness: -4 },
    ]) {
      expect(
        NukeExplosionAttributesSchema.safeParse({ ...atomShockwave, ...patch })
          .success,
      ).toBe(false);
    }
  });

  it("requires colors, size, speed, thickness, and transitionSpeed", () => {
    expect(
      NukeExplosionAttributesSchema.safeParse({
        type: "shockwave",
        nukeType: "atom",
      }).success,
    ).toBe(false);
  });
});

describe("nukeExplosion in the cosmetics catalog", () => {
  it("parses the atom shockwave catalog entry", () => {
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        nukeExplosion: {
          atom_shockwave_purple_red: {
            name: "atom_shockwave_purple_red",
            effectType: "nukeExplosion",
            attributes: {
              size: 50,
              speed: 50,
              thickness: 4,
              colors: ["#ff0000", "#bb00ff"],
              nukeType: "atom",
              type: "shockwave",
              transitionSpeed: 5,
            },
            affiliateCode: null,
            product: null,
            priceHard: 1,
            rarity: "common",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const eff = result.data.effects?.nukeExplosion?.atom_shockwave_purple_red;
      expect(eff?.effectType).toBe("nukeExplosion");
      expect(eff?.attributes.colors).toEqual(["#ff0000", "#bb00ff"]);
    }
  });

  it("parses the rgb sparkles catalog entry", () => {
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        nukeExplosion: {
          rgb_nuke_sparkles: {
            name: "rgb_nuke_sparkles",
            effectType: "nukeExplosion",
            attributes: {
              size: 250,
              type: "sparkles",
              speed: 10,
              colors: ["#ff0000", "#ffffff", "#0033ff"],
              nukeType: "atom",
              thickness: 3,
              transitionSpeed: 3,
              density: 150,
            },
            affiliateCode: null,
            product: null,
            priceHard: 1,
            rarity: "common",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const eff = result.data.effects?.nukeExplosion?.rgb_nuke_sparkles;
      expect(eff?.attributes.type).toBe("sparkles");
    }
  });

  it("drops a nukeExplosion effect with an unknown nukeType without failing the catalog", () => {
    const attrs = (nukeType: string) => ({
      type: "shockwave",
      nukeType,
      colors: [],
      size: 1,
      speed: 1,
      thickness: 1,
      transitionSpeed: 1,
    });
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        nukeExplosion: {
          atom: {
            name: "atom",
            effectType: "nukeExplosion",
            attributes: attrs("atom"),
            product: null,
            rarity: "common",
          },
          future: {
            name: "future",
            effectType: "nukeExplosion",
            attributes: attrs("hydrogen"),
            product: null,
            rarity: "common",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.effects?.nukeExplosion?.atom?.name).toBe("atom");
      expect(result.data.effects?.nukeExplosion?.future).toBeUndefined();
    }
  });
});

describe("structures effects", () => {
  const gradient = {
    name: "rwb_structure_gradient",
    effectType: "structures",
    attributes: {
      type: "gradient",
      colors: ["#f00000", "#ffffff", "#1000f5"],
      colorSize: 5,
      movementSpeed: 5,
    },
    affiliateCode: null,
    product: null,
    rarity: "common",
  };
  const transition = {
    name: "rwb_structure_transistion",
    effectType: "structures",
    attributes: {
      type: "transition",
      colors: ["#ff0000", "#ffffff", "#0008ff"],
      frequency: 5,
    },
    affiliateCode: null,
    product: null,
    priceHard: 1,
    rarity: "common",
  };

  it("parses the gradient and transition catalog entries", () => {
    const result = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        structures: {
          rwb_structure_gradient: gradient,
          rwb_structure_transistion: transition,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.effects?.structures?.rwb_structure_gradient?.attributes
          .type,
      ).toBe("gradient");
      expect(
        result.data.effects?.structures?.rwb_structure_transistion?.attributes
          .type,
      ).toBe("transition");
    }
  });

  it("resolves the structures slot (slot = effectType)", () => {
    expect(effectTypeForSlot("structures")).toBe("structures");
    const parsed = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: { structures: { rwb_structure_gradient: gradient } },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(
      findEffectForSlot(parsed.data, "structures", "rwb_structure_gradient")
        ?.name,
    ).toBe("rwb_structure_gradient");
  });

  it("shares trail attribute shapes but is not a trail effect", () => {
    const eff = EffectSchema.parse(gradient);
    // Renders through the structures palette block, not a trail block.
    expect(isTrailEffect(eff)).toBe(false);
    expect(effectMatchesSlot(eff, "structures")).toBe(true);
    expect(effectMatchesSlot(eff, "transportShipTrail")).toBe(false);
  });

  it("rejects a structures effect with an unknown attribute type", () => {
    expect(
      EffectSchema.safeParse({
        ...gradient,
        attributes: { type: "sparkle", colors: [] },
      }).success,
    ).toBe(false);
  });
});

describe("isTrailEffect", () => {
  it("is true for a trail effect and false for a nukeExplosion", () => {
    const trail = EffectSchema.parse({
      name: "spectrum",
      effectType: "transportShipTrail",
      product: null,
      rarity: "common",
      attributes: {
        type: "gradient",
        colors: ["#fff"],
        colorSize: 16,
        movementSpeed: 0.15,
      },
    });
    const boom = EffectSchema.parse({
      name: "atom_shockwave_purple_red",
      effectType: "nukeExplosion",
      product: null,
      rarity: "common",
      attributes: {
        type: "shockwave",
        nukeType: "atom",
        colors: ["#f00"],
        size: 50,
        speed: 50,
        thickness: 4,
        transitionSpeed: 5,
      },
    });
    expect(isTrailEffect(trail)).toBe(true);
    expect(isTrailEffect(boom)).toBe(false);
  });
});

describe("effect selection slots", () => {
  const trail: Effect = EffectSchema.parse({
    name: "spectrum",
    effectType: "transportShipTrail",
    product: null,
    rarity: "common",
    attributes: {
      type: "gradient",
      colors: ["#fff"],
      colorSize: 16,
      movementSpeed: 0.15,
    },
  });
  const atomBoom: Effect = EffectSchema.parse({
    name: "atom_boom",
    effectType: "nukeExplosion",
    product: null,
    rarity: "common",
    attributes: {
      type: "shockwave",
      nukeType: "atom",
      colors: ["#f00"],
      size: 50,
      speed: 50,
      thickness: 4,
      transitionSpeed: 5,
    },
  });

  it("isNukeExplosionEffect narrows nukeExplosion effects", () => {
    expect(isNukeExplosionEffect(atomBoom)).toBe(true);
    expect(isNukeExplosionEffect(trail)).toBe(false);
  });

  it("effectTypeForSlot maps trail slots to themselves and nukeTypes to nukeExplosion", () => {
    expect(effectTypeForSlot("transportShipTrail")).toBe("transportShipTrail");
    expect(effectTypeForSlot("nukeTrail")).toBe("nukeTrail");
    expect(effectTypeForSlot("atom")).toBe("nukeExplosion");
    expect(effectTypeForSlot("hydro")).toBe("nukeExplosion");
    expect(effectTypeForSlot("mirvWarhead")).toBe("nukeExplosion");
    // A bare "nukeExplosion" is no longer a valid slot (selection is per nukeType).
    expect(effectTypeForSlot("nukeExplosion")).toBeUndefined();
    expect(effectTypeForSlot("bogus")).toBeUndefined();
  });

  it("effectMatchesSlot ties a nuke effect to its own nukeType slot", () => {
    expect(effectMatchesSlot(atomBoom, "atom")).toBe(true);
    expect(effectMatchesSlot(atomBoom, "hydro")).toBe(false);
    expect(effectMatchesSlot(atomBoom, "mirvWarhead")).toBe(false);
    // A trail matches its effectType slot, not a nukeType slot.
    expect(effectMatchesSlot(trail, "transportShipTrail")).toBe(true);
    expect(effectMatchesSlot(trail, "atom")).toBe(false);
  });

  it("findEffectForSlot resolves a slot + name against the catalog", () => {
    const parsed = CosmeticsSchema.safeParse({
      patterns: {},
      flags: {},
      effects: {
        transportShipTrail: { spectrum: trail },
        nukeExplosion: { atom_boom: atomBoom },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const catalog = parsed.data;

    expect(findEffectForSlot(catalog, "atom", "atom_boom")?.name).toBe(
      "atom_boom",
    );
    expect(
      findEffectForSlot(catalog, "transportShipTrail", "spectrum")?.name,
    ).toBe("spectrum");
    // Slot mismatch: an atom effect can't fill the hydro slot.
    expect(findEffectForSlot(catalog, "hydro", "atom_boom")).toBeUndefined();
    // A bare effectType is not a nuke-explosion slot.
    expect(
      findEffectForSlot(catalog, "nukeExplosion", "atom_boom"),
    ).toBeUndefined();
    expect(findEffectForSlot(catalog, "atom", "missing")).toBeUndefined();
    expect(findEffectForSlot(catalog, "bogus", "atom_boom")).toBeUndefined();
    // No catalog (failed load) resolves nothing.
    expect(findEffectForSlot(null, "atom", "atom_boom")).toBeUndefined();
  });
});
