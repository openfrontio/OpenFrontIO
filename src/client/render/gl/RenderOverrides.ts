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
  if (overrides.railroad?.railMinZoom !== undefined) {
    settings.railroad.railMinZoom = overrides.railroad.railMinZoom;
  }
  if (overrides.railroad?.railThickness !== undefined) {
    settings.railroad.railThickness = overrides.railroad.railThickness;
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
    // wholesale — palette arrays differ in length between themes).
    settings.theme = createThemeSettings("colorblind");
    // Swap the red/green friend-foe encoding (the most common confusion axis)
    // for a colorblind-safe blue/orange pairing (Okabe-Ito).
    // Alt-view affiliation borders: self/ally in the blue family, enemy orange.
    settings.affiliation.selfR = 0;
    settings.affiliation.selfG = 0.447;
    settings.affiliation.selfB = 0.698;
    settings.affiliation.allyR = 0.337;
    settings.affiliation.allyG = 0.706;
    settings.affiliation.allyB = 0.914;
    settings.affiliation.enemyR = 0.835;
    settings.affiliation.enemyG = 0.369;
    settings.affiliation.enemyB = 0;
    // Normal-view relationship border tints: friendly blue, enemy orange,
    // applied strongly so the cue doesn't rely on subtle hue.
    settings.mapOverlay.friendlyTintR = 0;
    settings.mapOverlay.friendlyTintG = 0.447;
    settings.mapOverlay.friendlyTintB = 0.698;
    settings.mapOverlay.embargoTintR = 0.835;
    settings.mapOverlay.embargoTintG = 0.369;
    settings.mapOverlay.embargoTintB = 0;
    // Strong ratio so the friend/foe tint dominates the darkened territory
    // border — neutral keeps its (darkened) fill hue, ally reads blue, enemy
    // reads orange.
    settings.mapOverlay.friendlyTintRatio = 0.85;
    settings.mapOverlay.embargoTintRatio = 0.85;
  }
}
