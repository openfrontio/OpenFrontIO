import type { GraphicsOverrides } from "./GraphicsOverrides";
import { createThemeSettings, type RenderSettings } from "./RenderSettings";

const DARK_AMBIENT = 0.35;

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
  if (overrides.structure?.classicIcons === true) {
    // Classic look: lighter player-colored shape behind a darkened
    // player-colored icon glyph (matching the old canvas renderer's
    // structureColors().dark), with a touch of translucency.
    settings.structure.borderDarken = 0.7;
    settings.structure.fillDarken = 1.0;
    settings.structure.iconDarken = 0.3;
    settings.structure.iconAlpha = 0.9;
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
  if (overrides.railroad?.railMinZoom !== undefined) {
    settings.railroad.railMinZoom = overrides.railroad.railMinZoom;
  }
  if (overrides.railroad?.railThickness !== undefined) {
    settings.railroad.railThickness = overrides.railroad.railThickness;
  }
  if (overrides.passEnabled?.fx !== undefined) {
    settings.passEnabled.fx = overrides.passEnabled.fx;
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

/** Apply dark-mode lighting (ambient + enabled) onto settings when active. */
export function applyDarkModeOverride(
  settings: RenderSettings,
  isDark: boolean,
): void {
  if (!isDark) return;
  settings.lighting.ambient = DARK_AMBIENT;
  settings.lighting.enabled = true;
}
