import { describe, expect, test } from "vitest";
import {
  GraphicsOverrides,
  GraphicsOverridesSchema,
} from "../src/client/render/gl/GraphicsOverrides";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import { createRenderSettings } from "../src/client/render/gl/RenderSettings";

function gen(overrides: GraphicsOverrides) {
  const settings = createRenderSettings();
  applyGraphicsOverrides(settings, overrides);
  return settings;
}

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
      { name: { hoverGlowWidth: 5 } },
      { name: { hoverGlowAlpha: 0.6 } },
      { name: { nameScaleFactor: 1.2, cullThreshold: 0, darkNames: false } },
      { name: { hoverGlowWidth: 0, hoverGlowAlpha: 0 } },
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

  test("accepts partial mapOverlay overrides", () => {
    const cases = [
      { mapOverlay: {} },
      { mapOverlay: { territorySaturation: 0.5 } },
      { mapOverlay: { territoryAlpha: 0.8 } },
      { mapOverlay: { territorySaturation: 0, territoryAlpha: 1 } },
    ];
    for (const c of cases) {
      expect(GraphicsOverridesSchema.safeParse(c).success).toBe(true);
    }
  });

  test("accepts partial railroad overrides", () => {
    const cases = [
      { railroad: {} },
      { railroad: { railMinZoom: 2 } },
      { railroad: { railThickness: 1.5 } },
      { railroad: { railMinZoom: 0, railThickness: 3 } },
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
      GraphicsOverridesSchema.safeParse({ name: { hoverGlowWidth: "wide" } })
        .success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({ name: { hoverGlowAlpha: true } })
        .success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({
        structure: { classicIcons: "yes" },
      }).success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({
        mapOverlay: { territorySaturation: "full" },
      }).success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({
        railroad: { railMinZoom: "far" },
      }).success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({
        railroad: { railThickness: "wide" },
      }).success,
    ).toBe(false);
  });
});

describe("applyGraphicsOverrides", () => {
  test("with empty overrides applies default classic structure, otherwise matches createRenderSettings", () => {
    const fromGen = gen({});
    const fromCreate = createRenderSettings();
    // Classic icons are the default, so empty overrides still tune the
    // structure slice (borderDarken/fillDarken/iconDarken/iconAlpha).
    expect(fromGen.structure.borderDarken).toBe(0.7);
    expect(fromGen.structure.fillDarken).toBe(1.0);
    expect(fromGen.structure.iconDarken).toBe(0.3);
    expect(fromGen.structure.iconAlpha).toBe(0.9);
    // Everything outside the structure slice is left at createRenderSettings
    // defaults.
    fromCreate.structure = fromGen.structure;
    expect(fromGen).toEqual(fromCreate);
  });

  test("returns a fresh object each call (no shared mutation)", () => {
    const a = gen({});
    const b = gen({});
    expect(a).not.toBe(b);
    expect(a.name).not.toBe(b.name);
    a.name.nameScaleFactor = 999;
    expect(b.name.nameScaleFactor).not.toBe(999);
  });

  test("does not mutate the overrides input", () => {
    const overrides = { name: { darkNames: true as const } };
    const snapshot = JSON.parse(JSON.stringify(overrides));
    gen(overrides);
    expect(overrides).toEqual(snapshot);
  });

  test("applies nameScaleFactor override", () => {
    const settings = gen({ name: { nameScaleFactor: 1.3 } });
    expect(settings.name.nameScaleFactor).toBe(1.3);
  });

  test("applies cullThreshold override (including 0)", () => {
    expect(gen({ name: { cullThreshold: 0.03 } }).name.cullThreshold).toBe(
      0.03,
    );
    expect(gen({ name: { cullThreshold: 0 } }).name.cullThreshold).toBe(0);
  });

  test("applies hoverGlowWidth override (including 0)", () => {
    expect(gen({ name: { hoverGlowWidth: 6 } }).name.hoverGlowWidth).toBe(6);
    expect(gen({ name: { hoverGlowWidth: 0 } }).name.hoverGlowWidth).toBe(0);
  });

  test("applies hoverGlowAlpha override (including 0)", () => {
    expect(gen({ name: { hoverGlowAlpha: 0.9 } }).name.hoverGlowAlpha).toBe(
      0.9,
    );
    expect(gen({ name: { hoverGlowAlpha: 0 } }).name.hoverGlowAlpha).toBe(0);
  });

  test("hover glow overrides leave other name fields at defaults", () => {
    const defaults = createRenderSettings().name;
    const s = gen({
      name: { hoverGlowWidth: 7, hoverGlowAlpha: 0.1 },
    }).name;
    expect(s.hoverFadeAlpha).toBe(defaults.hoverFadeAlpha);
    expect(s.nameScaleFactor).toBe(defaults.nameScaleFactor);
    expect(s.cullThreshold).toBe(defaults.cullThreshold);
  });

  test("darkNames=true → black fill + player-colored outline + outline RGB 0", () => {
    const s = gen({ name: { darkNames: true } }).name;
    expect(s.fillUsePlayerColor).toBe(false);
    expect(s.outlineUsePlayerColor).toBe(true);
    expect(s.outlineR).toBe(0);
    expect(s.outlineG).toBe(0);
    expect(s.outlineB).toBe(0);
  });

  test("darkNames=false → player-colored fill + white outline + outline RGB 1", () => {
    const s = gen({ name: { darkNames: false } }).name;
    expect(s.fillUsePlayerColor).toBe(true);
    expect(s.outlineUsePlayerColor).toBe(false);
    expect(s.outlineR).toBe(1);
    expect(s.outlineG).toBe(1);
    expect(s.outlineB).toBe(1);
  });

  test("only-darkNames override leaves nameScale/cull at defaults", () => {
    const defaults = createRenderSettings().name;
    const s = gen({ name: { darkNames: true } }).name;
    expect(s.nameScaleFactor).toBe(defaults.nameScaleFactor);
    expect(s.cullThreshold).toBe(defaults.cullThreshold);
  });

  test("combined overrides all apply together", () => {
    const s = gen({
      name: { nameScaleFactor: 0.9, cullThreshold: 0.01, darkNames: true },
    }).name;
    expect(s.nameScaleFactor).toBe(0.9);
    expect(s.cullThreshold).toBe(0.01);
    expect(s.fillUsePlayerColor).toBe(false);
    expect(s.outlineUsePlayerColor).toBe(true);
    expect(s.outlineR).toBe(0);
  });

  test("settings outside the name slice are untouched by name overrides", () => {
    // Baseline is empty overrides (which apply the default classic structure),
    // so name overrides should leave the non-name slices identical to it.
    const base = gen({});
    const s = gen({
      name: { nameScaleFactor: 0.6, darkNames: true },
    });
    expect(s.passEnabled).toEqual(base.passEnabled);
    expect(s.lighting).toEqual(base.lighting);
    expect(s.structure).toEqual(base.structure);
  });

  test("classicIcons=true → light shape + dark icon + 0.9 alpha", () => {
    const s = gen({
      structure: { classicIcons: true },
    }).structure;
    // Shape (circle behind) is mostly player color, lightly darkened.
    expect(s.fillDarken).toBe(1.0);
    expect(s.borderDarken).toBe(0.7);
    // Icon glyph is a darkened version of the player color.
    expect(s.iconDarken).toBe(0.3);
    // Slightly translucent in classic mode.
    expect(s.iconAlpha).toBe(0.9);
  });

  test("classicIcons=false → keeps render-settings.json defaults (fully opaque)", () => {
    const defaults = createRenderSettings().structure;
    const off = gen({
      structure: { classicIcons: false },
    }).structure;
    expect(off.borderDarken).toBe(defaults.borderDarken);
    expect(off.fillDarken).toBe(defaults.fillDarken);
    expect(off.iconDarken).toBe(0);
    expect(off.iconAlpha).toBe(1);
  });

  test("classicIcons absent → applies classic styling by default", () => {
    const absent = gen({ structure: {} }).structure;
    expect(absent.borderDarken).toBe(0.7);
    expect(absent.fillDarken).toBe(1.0);
    expect(absent.iconDarken).toBe(0.3);
    expect(absent.iconAlpha).toBe(0.9);
  });

  test("applies territorySaturation override (including 0)", () => {
    expect(
      gen({ mapOverlay: { territorySaturation: 0.4 } }).mapOverlay
        .territorySaturation,
    ).toBe(0.4);
    expect(
      gen({ mapOverlay: { territorySaturation: 0 } }).mapOverlay
        .territorySaturation,
    ).toBe(0);
  });

  test("applies territoryAlpha override (including 0)", () => {
    expect(
      gen({ mapOverlay: { territoryAlpha: 0.3 } }).mapOverlay.territoryAlpha,
    ).toBe(0.3);
    expect(
      gen({ mapOverlay: { territoryAlpha: 0 } }).mapOverlay.territoryAlpha,
    ).toBe(0);
  });

  test("mapOverlay override leaves other mapOverlay fields at defaults", () => {
    const defaults = createRenderSettings().mapOverlay;
    const mo = gen({ mapOverlay: { territorySaturation: 0.2 } }).mapOverlay;
    expect(mo.territoryAlpha).toBe(defaults.territoryAlpha);
    expect(mo.territoryDefenseDarken).toBe(defaults.territoryDefenseDarken);
  });

  test("applies railMinZoom override (including 0)", () => {
    expect(gen({ railroad: { railMinZoom: 7 } }).railroad.railMinZoom).toBe(7);
    expect(gen({ railroad: { railMinZoom: 0 } }).railroad.railMinZoom).toBe(0);
  });

  test("applies railThickness override (including values below 1)", () => {
    expect(
      gen({ railroad: { railThickness: 2.5 } }).railroad.railThickness,
    ).toBe(2.5);
    expect(
      gen({ railroad: { railThickness: 0.5 } }).railroad.railThickness,
    ).toBe(0.5);
  });

  test("railroad override leaves other railroad fields at defaults", () => {
    const defaults = createRenderSettings().railroad;
    const r = gen({ railroad: { railThickness: 2 } }).railroad;
    expect(r.railMinZoom).toBe(defaults.railMinZoom);
    expect(r.railFadeRange).toBe(defaults.railFadeRange);
    expect(r.railDetailZoom).toBe(defaults.railDetailZoom);
    expect(r.railAlpha).toBe(defaults.railAlpha);
    const z = gen({ railroad: { railMinZoom: 1 } }).railroad;
    expect(z.railThickness).toBe(defaults.railThickness);
  });

  test("classicIcons + name overrides compose independently", () => {
    const s = gen({
      name: { darkNames: true, nameScaleFactor: 0.9 },
      structure: { classicIcons: true },
    });
    expect(s.name.fillUsePlayerColor).toBe(false);
    expect(s.name.nameScaleFactor).toBe(0.9);
    expect(s.structure.borderDarken).toBe(0.7);
    expect(s.structure.fillDarken).toBe(1.0);
    expect(s.structure.iconAlpha).toBe(0.9);
  });
});
