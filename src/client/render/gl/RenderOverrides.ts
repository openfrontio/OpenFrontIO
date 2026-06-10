import type { GraphicsOverrides } from "./GraphicsOverrides";
import type { RenderSettings } from "./RenderSettings";

const DARK_AMBIENT = 0.35;

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
  if (overrides.structure?.classicIcons === true) {
    // Classic look: lighter player-colored shape behind a dark icon glyph,
    // with a touch of translucency.
    settings.structure.borderDarken = 0.7;
    settings.structure.fillDarken = 1.0;
    settings.structure.iconR = 0;
    settings.structure.iconG = 0;
    settings.structure.iconB = 0;
    settings.structure.iconAlpha = 0.75;
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
  if (overrides.railroad?.railMinZoom !== undefined) {
    settings.railroad.railMinZoom = overrides.railroad.railMinZoom;
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
}

export function applyDarkModeOverride(
  settings: RenderSettings,
  isDark: boolean,
): void {
  if (!isDark) return;
  settings.lighting.ambient = DARK_AMBIENT;
  settings.lighting.enabled = true;
}
