import type { GraphicsOverrides } from "./GraphicsOverrides";
import { createThemeSettings, type RenderSettings } from "./RenderSettings";
import { hexToRgb } from "./utils/ColorUtils";

/**
 * Apply the user's graphics overrides onto a RenderSettings in place: name
 * scaling, classic/dark structure and name styling, and the colorblind-safe
 * affiliation/tint palette.
 */
export function applyGraphicsOverrides(
  settings: RenderSettings,
  overrides: GraphicsOverrides,
): void {
  if (overrides.name?.nameScaleFactor !== undefined) {
    settings.name.nameScaleFactor = overrides.name.nameScaleFactor;
  }
  if (overrides.name?.cullThreshold !== undefined) {
    settings.name.cullThreshold = overrides.name.cullThreshold;
  }
  if (overrides.name?.hoverFadeAlpha !== undefined) {
    settings.name.hoverFadeAlpha = overrides.name.hoverFadeAlpha;
  }
  if (overrides.name?.hoverGlowWidth !== undefined) {
    settings.name.hoverGlowWidth = overrides.name.hoverGlowWidth;
  }
  if (overrides.name?.hoverGlowAlpha !== undefined) {
    settings.name.hoverGlowAlpha = overrides.name.hoverGlowAlpha;
  }
  if (overrides.structure?.iconSize !== undefined) {
    settings.structure.iconSize = overrides.structure.iconSize;
  }
  if (overrides.structure?.classicIcons ?? true) {
    // Classic look (default): lighter player-colored shape behind a darkened
    // player-colored icon glyph (matching the old canvas renderer's
    // structureColors().dark), with a touch of translucency.
    settings.structure.borderDarken = 0.7;
    settings.structure.fillDarken = 1.0;
    settings.structure.iconDarken = 0.3;
    settings.structure.iconAlpha = 0.9;
  }

  if (overrides.structure?.classicNumbers !== undefined) {
    settings.structureLevel.classicFont = overrides.structure.classicNumbers;
  }
  if (overrides.structure?.showDots === false) {
    // Zoom is always > 0, so a threshold of 0 means the dots LOD never
    // triggers — structures stay as full icons at every zoom level.
    settings.structure.dotsZoomThreshold = 0;
  }
  if (overrides.mapOverlay?.navalHighlight !== undefined) {
    settings.mapOverlay.navalHighlight = overrides.mapOverlay.navalHighlight;
  }
  if (overrides.mapOverlay?.highlightFillBrighten !== undefined) {
    settings.mapOverlay.highlightFillBrighten =
      overrides.mapOverlay.highlightFillBrighten;
  }
  if (overrides.mapOverlay?.highlightBrighten !== undefined) {
    settings.mapOverlay.highlightBrighten =
      overrides.mapOverlay.highlightBrighten;
  }
  if (overrides.mapOverlay?.highlightThicken !== undefined) {
    settings.mapOverlay.highlightThicken =
      overrides.mapOverlay.highlightThicken;
  }
  if (overrides.mapOverlay?.territorySaturation !== undefined) {
    settings.mapOverlay.territorySaturation =
      overrides.mapOverlay.territorySaturation;
  }
  if (overrides.mapOverlay?.territoryAlpha !== undefined) {
    settings.mapOverlay.territoryAlpha = overrides.mapOverlay.territoryAlpha;
  }
  if (overrides.mapOverlay?.coordinateGridOpacity !== undefined) {
    settings.mapOverlay.coordinateGridOpacity =
      overrides.mapOverlay.coordinateGridOpacity;
  }
  if (overrides.mapOverlay?.staleNukeColor !== undefined) {
    // hexToRgb yields 0-255 channels; the stale-nuke uniforms are 0-1 floats.
    const rgb = hexToRgb(overrides.mapOverlay.staleNukeColor);
    if (rgb !== null) {
      settings.mapOverlay.staleNukeR = rgb[0] / 255;
      settings.mapOverlay.staleNukeG = rgb[1] / 255;
      settings.mapOverlay.staleNukeB = rgb[2] / 255;
    }
  }
  if (overrides.mapOverlay?.friendlyTintColor !== undefined) {
    applyHexColor(overrides.mapOverlay.friendlyTintColor, (r, g, b) => {
      settings.mapOverlay.friendlyTintR = r;
      settings.mapOverlay.friendlyTintG = g;
      settings.mapOverlay.friendlyTintB = b;
    });
  }
  if (overrides.mapOverlay?.embargoTintColor !== undefined) {
    applyHexColor(overrides.mapOverlay.embargoTintColor, (r, g, b) => {
      settings.mapOverlay.embargoTintR = r;
      settings.mapOverlay.embargoTintG = g;
      settings.mapOverlay.embargoTintB = b;
    });
  }
  if (overrides.mapOverlay?.friendlyTintRatio !== undefined) {
    settings.mapOverlay.friendlyTintRatio =
      overrides.mapOverlay.friendlyTintRatio;
  }
  if (overrides.mapOverlay?.embargoTintRatio !== undefined) {
    settings.mapOverlay.embargoTintRatio =
      overrides.mapOverlay.embargoTintRatio;
  }
  if (overrides.affiliation?.selfColor !== undefined) {
    applyHexColor(overrides.affiliation.selfColor, (r, g, b) => {
      settings.affiliation.selfR = r;
      settings.affiliation.selfG = g;
      settings.affiliation.selfB = b;
    });
  }
  if (overrides.affiliation?.allyColor !== undefined) {
    applyHexColor(overrides.affiliation.allyColor, (r, g, b) => {
      settings.affiliation.allyR = r;
      settings.affiliation.allyG = g;
      settings.affiliation.allyB = b;
    });
  }
  if (overrides.affiliation?.enemyColor !== undefined) {
    applyHexColor(overrides.affiliation.enemyColor, (r, g, b) => {
      settings.affiliation.enemyR = r;
      settings.affiliation.enemyG = g;
      settings.affiliation.enemyB = b;
    });
  }
  if (overrides.railroad?.railMinZoom !== undefined) {
    settings.railroad.railMinZoom = overrides.railroad.railMinZoom;
  }
  if (overrides.railroad?.railThickness !== undefined) {
    settings.railroad.railThickness = overrides.railroad.railThickness;
  }
  if (overrides.smallPlayerGlow?.strength !== undefined) {
    settings.smallPlayerGlow.strength = overrides.smallPlayerGlow.strength;
  }
  if (overrides.passEnabled?.fx !== undefined) {
    settings.passEnabled.fx = overrides.passEnabled.fx;
  }
  if (overrides.passEnabled?.fallout !== undefined) {
    // One user-facing toggle drives both fallout passes: the territory bloom
    // and its additive light contribution in the day/night composite.
    settings.passEnabled.falloutBloom = overrides.passEnabled.fallout;
    settings.passEnabled.falloutLight = overrides.passEnabled.fallout;
  }
  if (overrides.terrain?.oceanColor !== undefined) {
    settings.terrain.oceanColor = overrides.terrain.oceanColor;
  }
  if (overrides.terrain?.sandColor !== undefined) {
    settings.terrain.sandColor = overrides.terrain.sandColor;
  }
  if (overrides.terrain?.plainsColor !== undefined) {
    settings.terrain.plainsColor = overrides.terrain.plainsColor;
  }
  if (overrides.terrain?.highlandColor !== undefined) {
    settings.terrain.highlandColor = overrides.terrain.highlandColor;
  }
  if (overrides.terrain?.mountainColor !== undefined) {
    settings.terrain.mountainColor = overrides.terrain.mountainColor;
  }
  if (overrides.lighting?.ambient !== undefined) {
    settings.lighting.ambient = overrides.lighting.ambient;
    // The composite only darkens the scene (and reveals the structure/unit
    // glow) when ambient < 1; at ambient === 1 it's a visual identity, so
    // don't pay the scene-capture cost of enabling the lighting pass.
    settings.lighting.enabled = overrides.lighting.ambient < 1;
  }
  if (overrides.lighting?.falloffPower !== undefined) {
    settings.lighting.falloffPower = overrides.lighting.falloffPower;
  }
  if (overrides.name?.darkNames !== undefined) {
    const dark = overrides.name.darkNames;
    // Dark: black fill + player-colored outline. Force outline RGB to black
    // so the shader's defaultFill ramp (mix(uOutlineColor, black, fillT))
    // collapses to pure black regardless of ambient.
    // Colored: player-colored fill + white outline (defaults from JSON).
    settings.name.fillUsePlayerColor = !dark;
    settings.name.outlineUsePlayerColor = dark;
    const channel = dark ? 0 : 1;
    settings.name.outlineR = channel;
    settings.name.outlineG = channel;
    settings.name.outlineB = channel;
  }
  if (overrides.accessibility?.colorblind === true) {
    // Swap the active theme slice for the colorblind palette (replaced
    // wholesale — palette arrays differ in length between themes). The rest
    // of the colorblind look — the Okabe-Ito blue/orange friend-foe border
    // colors replacing the red/green encoding — is plain override data
    // carried by the Colorblind preset in graphics-presets.json.
    settings.theme = createThemeSettings("colorblind");
  }
}

// hexToRgb yields 0-255 channels; the renderer uniforms are 0-1 floats.
function applyHexColor(
  hex: string,
  assign: (r: number, g: number, b: number) => void,
): void {
  const rgb = hexToRgb(hex);
  if (rgb !== null) {
    assign(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  }
}
