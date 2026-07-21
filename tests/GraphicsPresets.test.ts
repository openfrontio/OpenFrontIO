import { describe, expect, it } from "vitest";
import builtinPresets from "../src/client/render/gl/graphics-presets.json";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import {
  createRenderSettings,
  createThemeSettings,
} from "../src/client/render/gl/RenderSettings";

describe("built-in graphics presets", () => {
  it("every preset's overrides validate against the schema", () => {
    for (const preset of builtinPresets) {
      const parsed = GraphicsOverridesSchema.safeParse(preset.overrides);
      expect(parsed.success, `${preset.nameKey}: ${parsed.error}`).toBe(true);
    }
  });

  it("colorblind preset applies the Okabe-Ito friend-foe colors and theme", () => {
    const colorblind = builtinPresets.find(
      (p) => p.nameKey === "graphics_setting.preset_colorblind",
    );
    expect(colorblind).toBeDefined();

    const settings = createRenderSettings();
    applyGraphicsOverrides(
      settings,
      GraphicsOverridesSchema.parse(colorblind!.overrides),
    );

    // Alt-view affiliation borders: self/ally blue family, enemy orange.
    expect(settings.affiliation.selfR).toBeCloseTo(0, 2);
    expect(settings.affiliation.selfG).toBeCloseTo(0.447, 2);
    expect(settings.affiliation.selfB).toBeCloseTo(0.698, 2);
    expect(settings.affiliation.allyR).toBeCloseTo(0.337, 2);
    expect(settings.affiliation.allyG).toBeCloseTo(0.706, 2);
    expect(settings.affiliation.allyB).toBeCloseTo(0.914, 2);
    expect(settings.affiliation.enemyR).toBeCloseTo(0.835, 2);
    expect(settings.affiliation.enemyG).toBeCloseTo(0.369, 2);
    expect(settings.affiliation.enemyB).toBeCloseTo(0, 2);

    // Normal-view relationship border tints: friendly blue, enemy orange,
    // applied strongly so the cue doesn't rely on subtle hue.
    expect(settings.mapOverlay.friendlyTintR).toBeCloseTo(0, 2);
    expect(settings.mapOverlay.friendlyTintG).toBeCloseTo(0.447, 2);
    expect(settings.mapOverlay.friendlyTintB).toBeCloseTo(0.698, 2);
    expect(settings.mapOverlay.embargoTintR).toBeCloseTo(0.835, 2);
    expect(settings.mapOverlay.embargoTintG).toBeCloseTo(0.369, 2);
    expect(settings.mapOverlay.embargoTintB).toBeCloseTo(0, 2);
    expect(settings.mapOverlay.friendlyTintRatio).toBe(0.85);
    expect(settings.mapOverlay.embargoTintRatio).toBe(0.85);

    // The palette swap rides on the palette enum.
    expect(settings.theme).toEqual(createThemeSettings("colorblind"));
  });
});

describe("legacy colorblind flag", () => {
  it("accessibility.colorblind stored by old clients surfaces as the colorblind palette", async () => {
    const { UserSettings } = await import("../src/core/game/UserSettings");
    const userSettings = new UserSettings();
    // Old clients stored {accessibility:{colorblind:true}}; write it through
    // the settings cache in the pre-palette shape.
    userSettings.setGraphicsOverrides({
      accessibility: { colorblind: true },
    } as never);
    expect(userSettings.graphicsOverrides().palette).toBe("colorblind");

    // A save in the new shape sticks and stops the translation.
    userSettings.setGraphicsOverrides({});
    expect(userSettings.graphicsOverrides().palette).toBeUndefined();
  });
});
