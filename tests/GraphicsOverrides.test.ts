import { describe, expect, test } from "vitest";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import {
  createRenderSettings,
  generateRenderSettings,
} from "../src/client/render/gl/RenderSettings";

describe("GraphicsOverridesSchema", () => {
  test("accepts empty object", () => {
    expect(GraphicsOverridesSchema.safeParse({}).success).toBe(true);
  });

  test("accepts partial name overrides", () => {
    const cases = [
      { name: {} },
      { name: { nameScaleFactor: 0.8 } },
      { name: { cullThreshold: 0.02 } },
      { name: { darkNames: true } },
      { name: { nameScaleFactor: 1.2, cullThreshold: 0, darkNames: false } },
    ];
    for (const c of cases) {
      expect(GraphicsOverridesSchema.safeParse(c).success).toBe(true);
    }
  });

  test("accepts partial structure overrides", () => {
    const cases = [
      { structure: {} },
      { structure: { classicIcons: true } },
      { structure: { classicIcons: false } },
      { name: { darkNames: true }, structure: { classicIcons: true } },
    ];
    for (const c of cases) {
      expect(GraphicsOverridesSchema.safeParse(c).success).toBe(true);
    }
  });

  test("rejects wrong field types", () => {
    expect(
      GraphicsOverridesSchema.safeParse({ name: { nameScaleFactor: "big" } })
        .success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({ name: { darkNames: "yes" } }).success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({
        structure: { classicIcons: "yes" },
      }).success,
    ).toBe(false);
  });
});

describe("generateRenderSettings", () => {
  test("with empty overrides matches createRenderSettings defaults", () => {
    const fromGen = generateRenderSettings({});
    const fromCreate = createRenderSettings();
    expect(fromGen).toEqual(fromCreate);
  });

  test("returns a fresh object each call (no shared mutation)", () => {
    const a = generateRenderSettings({});
    const b = generateRenderSettings({});
    expect(a).not.toBe(b);
    expect(a.name).not.toBe(b.name);
    a.name.nameScaleFactor = 999;
    expect(b.name.nameScaleFactor).not.toBe(999);
  });

  test("does not mutate the overrides input", () => {
    const overrides = { name: { darkNames: true as const } };
    const snapshot = JSON.parse(JSON.stringify(overrides));
    generateRenderSettings(overrides);
    expect(overrides).toEqual(snapshot);
  });

  test("applies nameScaleFactor override", () => {
    const settings = generateRenderSettings({ name: { nameScaleFactor: 1.3 } });
    expect(settings.name.nameScaleFactor).toBe(1.3);
  });

  test("applies cullThreshold override (including 0)", () => {
    expect(
      generateRenderSettings({ name: { cullThreshold: 0.03 } }).name
        .cullThreshold,
    ).toBe(0.03);
    expect(
      generateRenderSettings({ name: { cullThreshold: 0 } }).name.cullThreshold,
    ).toBe(0);
  });

  test("darkNames=true → black fill + player-colored outline + outline RGB 0", () => {
    const s = generateRenderSettings({ name: { darkNames: true } }).name;
    expect(s.fillUsePlayerColor).toBe(false);
    expect(s.outlineUsePlayerColor).toBe(true);
    expect(s.outlineR).toBe(0);
    expect(s.outlineG).toBe(0);
    expect(s.outlineB).toBe(0);
  });

  test("darkNames=false → player-colored fill + white outline + outline RGB 1", () => {
    const s = generateRenderSettings({ name: { darkNames: false } }).name;
    expect(s.fillUsePlayerColor).toBe(true);
    expect(s.outlineUsePlayerColor).toBe(false);
    expect(s.outlineR).toBe(1);
    expect(s.outlineG).toBe(1);
    expect(s.outlineB).toBe(1);
  });

  test("only-darkNames override leaves nameScale/cull at defaults", () => {
    const defaults = createRenderSettings().name;
    const s = generateRenderSettings({ name: { darkNames: true } }).name;
    expect(s.nameScaleFactor).toBe(defaults.nameScaleFactor);
    expect(s.cullThreshold).toBe(defaults.cullThreshold);
  });

  test("combined overrides all apply together", () => {
    const s = generateRenderSettings({
      name: { nameScaleFactor: 0.9, cullThreshold: 0.01, darkNames: true },
    }).name;
    expect(s.nameScaleFactor).toBe(0.9);
    expect(s.cullThreshold).toBe(0.01);
    expect(s.fillUsePlayerColor).toBe(false);
    expect(s.outlineUsePlayerColor).toBe(true);
    expect(s.outlineR).toBe(0);
  });

  test("settings outside the name slice are untouched by name overrides", () => {
    const defaults = createRenderSettings();
    const s = generateRenderSettings({
      name: { nameScaleFactor: 0.6, darkNames: true },
    });
    expect(s.passEnabled).toEqual(defaults.passEnabled);
    expect(s.dayNight).toEqual(defaults.dayNight);
    expect(s.structure).toEqual(defaults.structure);
  });

  test("classicIcons=true → light shape + dark icon + 0.75 alpha", () => {
    const s = generateRenderSettings({
      structure: { classicIcons: true },
    }).structure;
    // Shape (circle behind) is mostly player color, lightly darkened.
    expect(s.fillDarken).toBe(1.0);
    expect(s.borderDarken).toBe(0.7);
    // Icon glyph itself is black.
    expect(s.iconR).toBe(0);
    expect(s.iconG).toBe(0);
    expect(s.iconB).toBe(0);
    // Slightly translucent in classic mode.
    expect(s.iconAlpha).toBe(0.75);
  });

  test("classicIcons=false or absent → keeps render-settings.json defaults (fully opaque)", () => {
    const defaults = createRenderSettings().structure;
    const off = generateRenderSettings({
      structure: { classicIcons: false },
    }).structure;
    expect(off.borderDarken).toBe(defaults.borderDarken);
    expect(off.fillDarken).toBe(defaults.fillDarken);
    expect(off.iconR).toBe(defaults.iconR);
    expect(off.iconAlpha).toBe(1);
    const absent = generateRenderSettings({ structure: {} }).structure;
    expect(absent.borderDarken).toBe(defaults.borderDarken);
    expect(absent.fillDarken).toBe(defaults.fillDarken);
    expect(absent.iconR).toBe(defaults.iconR);
    expect(absent.iconAlpha).toBe(1);
  });

  test("classicIcons + name overrides compose independently", () => {
    const s = generateRenderSettings({
      name: { darkNames: true, nameScaleFactor: 0.9 },
      structure: { classicIcons: true },
    });
    expect(s.name.fillUsePlayerColor).toBe(false);
    expect(s.name.nameScaleFactor).toBe(0.9);
    expect(s.structure.borderDarken).toBe(0.7);
    expect(s.structure.fillDarken).toBe(1.0);
    expect(s.structure.iconAlpha).toBe(0.75);
  });
});
