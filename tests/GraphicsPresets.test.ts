import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  migrateLegacyGraphicsSettings,
  parseGraphicsOverridesJson,
} from "../src/client/GraphicsPresets";
import builtinPresets from "../src/client/render/gl/graphics-presets.json";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import { applyGraphicsOverrides } from "../src/client/render/gl/RenderOverrides";
import {
  createRenderSettings,
  createThemeSettings,
} from "../src/client/render/gl/RenderSettings";
import {
  GRAPHICS_KEY,
  GRAPHICS_PRESETS_KEY,
  UserSettings,
} from "../src/core/game/UserSettings";

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

describe("migrateLegacyGraphicsSettings", () => {
  const userSettings = new UserSettings();

  beforeEach(() => {
    userSettings.removeCached(GRAPHICS_KEY);
    userSettings.removeCached(GRAPHICS_PRESETS_KEY);
  });

  it("snapshots pre-existing custom overrides into a preset and leaves them active", () => {
    userSettings.setGraphicsOverrides({ name: { nameScaleFactor: 2 } });
    migrateLegacyGraphicsSettings(userSettings);
    expect(userSettings.graphicsOverrides()).toEqual({
      name: { nameScaleFactor: 2 },
    });
    expect(Object.values(userSettings.graphicsPresets())).toEqual([
      { name: { nameScaleFactor: 2 } },
    ]);
  });

  it("upgrades a palette-only legacy colorblind config to the full Colorblind preset", () => {
    userSettings.setGraphicsOverrides({
      accessibility: { colorblind: true },
    } as never);
    migrateLegacyGraphicsSettings(userSettings);
    const colorblind = BUILTIN_PRESETS.find(
      (p) => p.nameKey === "graphics_setting.preset_colorblind",
    );
    expect(userSettings.graphicsOverrides()).toEqual(colorblind!.overrides);
    // Matches a built-in, so no phantom saved preset.
    expect(userSettings.graphicsPresets()).toEqual({});
  });

  it("grafts the Colorblind borders onto legacy colorblind configs with other tweaks", () => {
    userSettings.setGraphicsOverrides({
      accessibility: { colorblind: true },
      name: { nameScaleFactor: 2 },
    } as never);
    migrateLegacyGraphicsSettings(userSettings);
    const overrides = userSettings.graphicsOverrides();
    expect(overrides.name).toEqual({ nameScaleFactor: 2 });
    expect(overrides.palette).toBe("colorblind");
    // The Okabe-Ito borders the old colorblind boolean hardcoded.
    expect(overrides.affiliation).toEqual({
      selfColor: "#0072b2",
      allyColor: "#56b4e9",
      enemyColor: "#d55e00",
    });
    expect(overrides.mapOverlay).toEqual({
      friendlyTintColor: "#0072b2",
      embargoTintColor: "#d55e00",
      friendlyTintRatio: 0.85,
      embargoTintRatio: 0.85,
    });
    expect(Object.values(userSettings.graphicsPresets())).toEqual([overrides]);
  });

  it("stamps fresh profiles with no phantom preset and never runs twice", () => {
    migrateLegacyGraphicsSettings(userSettings);
    expect(userSettings.graphicsPresets()).toEqual({});
    // Custom tweaks made after the stamp are not re-snapshotted.
    userSettings.setGraphicsOverrides({ name: { nameScaleFactor: 2 } });
    migrateLegacyGraphicsSettings(userSettings);
    expect(userSettings.graphicsPresets()).toEqual({});
  });
});

describe("parseGraphicsOverridesJson", () => {
  it("accepts valid overrides JSON", () => {
    expect(
      parseGraphicsOverridesJson(
        '{"palette":"colorblind","lighting":{"ambient":0.36}}',
      ),
    ).toEqual({ palette: "colorblind", lighting: { ambient: 0.36 } });
  });

  it("rejects invalid JSON and non-objects", () => {
    expect(parseGraphicsOverridesJson("not json")).toBeNull();
    expect(parseGraphicsOverridesJson("5")).toBeNull();
    expect(parseGraphicsOverridesJson("null")).toBeNull();
    expect(parseGraphicsOverridesJson("[]")).toBeNull();
  });

  it("rejects unknown keys instead of stripping them to an empty config", () => {
    // The schema strips unknown keys when reading stored data; a paste that
    // survives only by stripping must not silently wipe the user's settings.
    expect(parseGraphicsOverridesJson('{"nmae":{"nameScaleFactor":2}}')).toBe(
      null,
    );
    expect(parseGraphicsOverridesJson('{"name":{"nameScale":2}}')).toBe(null);
    expect(
      parseGraphicsOverridesJson('{"accessibility":{"colorblind":true}}'),
    ).toBe(null);
  });
});
