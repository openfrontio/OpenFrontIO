import { describe, expect, test } from "vitest";
import {
  catalogSnippet,
  defaultSlotState,
  EFFECT_GUI_TYPES,
  fieldsForType,
  slotAttributes,
} from "../src/client/debug/EffectGuiState";
import { EFFECT_TYPES } from "../src/core/CosmeticSchemas";

describe("slotAttributes", () => {
  test("every slot's default state validates for every type it offers", () => {
    for (const effectType of EFFECT_TYPES) {
      for (const type of EFFECT_GUI_TYPES[effectType]) {
        const s = { ...defaultSlotState(effectType), type };
        expect(slotAttributes(effectType, s), `${effectType}/${type}`).not.toBe(
          null,
        );
      }
    }
  });

  test("picks only the fields the type uses", () => {
    const s = { ...defaultSlotState("structures"), type: "transition" };
    s.colorCount = 3;
    s.frequency = 2.5;
    expect(slotAttributes("structures", s)).toEqual({
      type: "transition",
      colors: s.colors.slice(0, 3),
      frequency: 2.5,
    });

    const spiral = { ...defaultSlotState("nukeTrail"), type: "spiral" };
    expect(slotAttributes("nukeTrail", spiral)).toEqual({
      type: "spiral",
      colors: spiral.colors.slice(0, spiral.colorCount),
      radius: spiral.radius,
      strands: spiral.strands,
      rotationSpeed: spiral.rotationSpeed,
    });
  });

  test("nuke explosion carries nukeType; density only for sparkles/embers", () => {
    const s = defaultSlotState("nukeExplosion");
    s.nukeType = "hydro";
    const shock = slotAttributes("nukeExplosion", { ...s, type: "shockwave" });
    expect(shock?.type).toBe("shockwave");
    expect(shock?.nukeType).toBe("hydro");
    expect(shock && "density" in shock).toBe(false);
    const embers = slotAttributes("nukeExplosion", { ...s, type: "embers" });
    expect(embers?.type).toBe("embers");
    expect(embers && (embers as { density: number }).density).toBe(s.density);
  });

  test("rejects state the catalog schema would reject", () => {
    const s = { ...defaultSlotState("nukeExplosion"), size: 0 };
    expect(slotAttributes("nukeExplosion", s)).toBe(null);
    // A trail type on a structures slot is not valid either.
    const spiralStructures = {
      ...defaultSlotState("structures"),
      type: "spiral",
    };
    expect(slotAttributes("structures", spiralStructures)).toBe(null);
  });

  test("clamps the color count to the palette size", () => {
    const s = { ...defaultSlotState("warship"), colorCount: 99 };
    expect(slotAttributes("warship", s)?.colors).toHaveLength(8);
  });
});

describe("fieldsForType", () => {
  test("hides density for the shockwave explosion", () => {
    expect(fieldsForType("nukeExplosion", "shockwave").has("density")).toBe(
      false,
    );
    expect(fieldsForType("nukeExplosion", "sparkles").has("density")).toBe(
      true,
    );
    expect(
      fieldsForType("transportShipTrail", "gradient").has("frequency"),
    ).toBe(false);
  });
});

describe("catalogSnippet", () => {
  test("emits a paste-ready effectType + attributes entry", () => {
    const s = defaultSlotState("warship");
    const parsed = JSON.parse(catalogSnippet("warship", s)!);
    expect(parsed.effectType).toBe("warship");
    expect(parsed.attributes).toEqual(slotAttributes("warship", s));
  });
});
