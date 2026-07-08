import colorblindTheme from "./colorblind-theme.json";
import defaultTheme from "./default-theme.json";
import defaults from "./render-settings.json";

/**
 * Theme data — player/team palettes and color-derivation knobs. Loaded from a
 * theme JSON file (default-theme.json or colorblind-theme.json) and combined
 * with render-settings.json at runtime so all graphics configuration flows
 * through one pipeline. Colors are hex strings; palettes are consumed by the
 * theme module (src/client/theme/), which generates team variations and
 * allocates player colors at runtime.
 */
export interface ThemeSettings {
  /**
   * Base color per colored team (keys match ColoredTeams). Per-player
   * variations are generated at runtime; Bot stays a single flat color.
   */
  teamColors: Record<string, string>;
  humanColors: string[];
  nationColors: string[];
  botColors: string[];
  /** Used when the primary palettes are exhausted. */
  fallbackColors: string[];
  /** Border = territory color darkened by this absolute amount. */
  borderDarken: number;
  /**
   * Border HSL lightness multiplier, applied before borderDarken. 1 = no-op.
   * Scaling keeps every border the same proportion darker than its fill
   * (used by the colorblind theme so dark fills don't collapse to black).
   */
  borderLightnessScale: number;
  defendedBorderDarkenLight: number;
  defendedBorderDarkenDark: number;
  /** Minimum LAB delta between structure fill and border colors. */
  structureContrastTarget: number;
  /** Border color of the local player's territory. */
  focusedBorderColor: string;
  /** Tint applied to unit sprites during spawn highlight. */
  spawnHighlightColor: string;
}

export interface RenderSettings {
  theme: ThemeSettings;
  passEnabled: {
    terrain: boolean;
    territory: boolean;
    borderCompute: boolean;
    borderStamp: boolean;
    trail: boolean;
    territoryPatterns: boolean;
    structure: boolean;
    unit: boolean;
    name: boolean;
    falloutBloom: boolean;
    falloutLight: boolean;
    railroad: boolean;
    fx: boolean;
    bar: boolean;
    nameDebug: boolean;
  };
  terrain: {
    /**
     * Base (shallowest) color of deep water as a "#rrggbb" hex string. The
     * per-depth brightness gradient is preserved relative to this color.
     */
    oceanColor: string;
  };
  falloutBloom: {
    broilSpeedCold: number;
    broilSpeedHot: number;
    noiseFreq1: number;
    noiseFreq2: number;
    contrastLoCold: number;
    contrastLoHot: number;
    contrastHiCold: number;
    contrastHiHot: number;
    metaFreq: number;
    intensityCold: number;
    intensityHot: number;
    metaInfluenceCold: number;
    metaInfluenceHot: number;
    opacityFadeEnd: number;
    bloomR: number;
    bloomG: number;
    bloomB: number;
    bloomCoverage: number;
    heatDecayPerTick: number;
    particleColorDarkR: number;
    particleColorDarkG: number;
    particleColorDarkB: number;
    particleColorBrightR: number;
    particleColorBrightG: number;
    particleColorBrightB: number;
    particleThresholdUnowned: number;
    particleThresholdOwned: number;
    particleFlickerSpeed: number;
    particleStrength: number;
    particleFreshScale: number;
  };
  lighting: {
    ambient: number;
    enabled: boolean;
    falloffPower: number;
    falloutLightR: number;
    falloutLightG: number;
    falloutLightB: number;
    falloutLightIntensity: number;
    falloutLightThreshold: number;
    emberLightR: number;
    emberLightG: number;
    emberLightB: number;
    emberLightIntensity: number;
    blurZoomDivisor: number;
    lightRadiusMultiplier: number;
  };
  mapOverlay: {
    trailAlpha: number;
    defenseCheckerDarken: number;
    territoryDefenseDarken: number;
    /** Saturation of the territory fill. 1 = full color, 0 = grayscale. */
    territorySaturation: number;
    /** Absolute opacity of the territory fill. 1 = fully opaque (terrain hidden), ~0.588 = default. */
    territoryAlpha: number;
    coordinateGridOpacity: number;
    staleNukeBase: number;
    staleNukeVariation: number;
    staleNukeAlpha: number;
    staleNukeR: number;
    staleNukeG: number;
    staleNukeB: number;
    highlightBrighten: number;
    highlightFillBrighten: number;
    highlightThicken: number;
    defensePostRange: number;
    embargoTintRatio: number;
    friendlyTintRatio: number;
    embargoTintR: number;
    embargoTintG: number;
    embargoTintB: number;
    friendlyTintR: number;
    friendlyTintG: number;
    friendlyTintB: number;
  };
  /** Alt-view affiliation colors (0–1 RGB). */
  affiliation: {
    selfR: number;
    selfG: number;
    selfB: number;
    allyR: number;
    allyG: number;
    allyB: number;
    neutralR: number;
    neutralG: number;
    neutralB: number;
    enemyR: number;
    enemyG: number;
    enemyB: number;
  };
  railroad: {
    railMinZoom: number;
    railFadeRange: number;
    railDetailZoom: number;
    railAlpha: number;
    /** Track width multiplier (1 = default width). */
    railThickness: number;
  };
  structure: {
    iconSize: number;
    dotsZoomThreshold: number;
    /** Icon size multiplier when zoomed out past dotsZoomThreshold. */
    dotScale: number;
    iconScaleFactorZoomedOut: number;
    /**
     * Zoom level at which structures begin growing with the canvas.
     * Below this zoom, structures stay at a fixed screen size (capped).
     * Above this zoom, they grow proportionally to zoom — i.e. world-anchored,
     * so they cover a fixed area of the map.
     */
    iconGrowZoom: number;
    shapes: Record<string, { scale: number; iconFill: number }>;
    highlightOutlineWidth: number;
    highlightDimAlpha: number;
    /** HSV value multiplier applied to the icon fill (interior). 1.0 = no darkening. */
    fillDarken: number;
    /** HSV value multiplier applied to the icon border (outer ring). 1.0 = no darkening. */
    borderDarken: number;
    /** Multiplier on final icon alpha. 1.0 = opaque. */
    iconAlpha: number;
    /** RGB color of the inner icon glyph */
    iconR: number;
    iconG: number;
    iconB: number;
    /**
     * When > 0, the icon glyph is a darkened version of the player color
     * (HSV value multiplier) instead of the flat iconR/G/B color. 0 = off.
     */
    iconDarken: number;
  };
  structureLevel: {
    scale: number;
    /** MSDF outline width in px; unused by the classic bitmap font. */
    outlineWidth: number;
    offsetY: number;
    /** true = round_6x6_modified bitmap font, false = overpass-bold MSDF. */
    classicFont: boolean;
  };
  bar: {
    healthBarW: number;
    healthBarH: number;
    healthBarOffsetY: number;
    progressBarW: number;
    progressBarH: number;
    progressBarOffsetY: number;
    borderWidth: number;
    threshold1: number;
    threshold2: number;
    threshold3: number;
    colorRedR: number;
    colorRedG: number;
    colorRedB: number;
    colorOrangeR: number;
    colorOrangeG: number;
    colorOrangeB: number;
    colorYellowR: number;
    colorYellowG: number;
    colorYellowB: number;
    colorGreenR: number;
    colorGreenG: number;
    colorGreenB: number;
  };
  unit: {
    unitSize: number;
    flickerSpeed: number;
    angryR: number;
    angryG: number;
    angryB: number;
    // Steady soft glow rendered underneath the hydrogen bomb
    hBombGlowScale: number; // quad enlargement factor (1 = no glow room)
    hBombGlowR: number;
    hBombGlowG: number;
    hBombGlowB: number;
    hBombGlowStrength: number; // peak opacity of the glow
    hBombGlowInner: number; // radial falloff start (0..1, quad-space)
    untargetableAlpha: number; // alpha for nukes SAMs can't target (0..1)
  };
  name: {
    lerpSpeed: number;
    cullThreshold: number;
    nameScaleFactor: number;
    nameScaleCap: number;
    troopSizeMultiplier: number;
    outlineWidth: number;
    outlineR: number;
    outlineG: number;
    outlineB: number;
    outlineUsePlayerColor: boolean;
    fillUsePlayerColor: boolean;
    /** Name fill grayscale shade by player type (0 = black). Human is always 0. */
    nameShadeNation: number;
    nameShadeBot: number;
    emojiRowOffset: number;
    statusRowOffset: number;
    /** Dark outline radius (atlas texels) drawn behind the alliance icon; 0 = off. */
    statusOutlineWidth: number;
    /** Alpha multiplier applied to a name while the cursor is over it. */
    hoverFadeAlpha: number;
    /** White glow behind the hovered player's name: px past the outline. */
    hoverGlowWidth: number;
    /** Peak opacity of the hover glow (0 disables it). */
    hoverGlowAlpha: number;
  };
  fx: {
    shockwaveRingWidth: number;
    attackRingScreenPx: number; // screen px — attack ring quad half-size (visible outer ring = 0.8×)
    nukeShockwaveDurationMs: number;
    nukeShockwaveRadiusFactor: number;
    samShockwaveDurationMs: number;
    samShockwaveRadius: number;
    debrisLifetimeMs: number;
    debrisFadeIn: number; // 0–1 fraction of lifetime
    debrisFadeOut: number; // 0–1 fraction of lifetime (start of fade)
    conquestLifetimeMs: number;
    conquestFadeIn: number;
    conquestFadeOut: number;
  };
  nukeTrajectory: {
    lineWidth: number; // px — main line stroke width
    outlineWidth: number; // px — extra width for outline behind line
    dashTargetable: number; // px — dash length in targetable zone
    gapTargetable: number; // px — gap length in targetable zone
    dashUntargetable: number; // px — dash length in untargetable zone
    gapUntargetable: number; // px — gap length in untargetable zone
    lineR: number; // normal line color
    lineG: number;
    lineB: number;
    interceptR: number; // line color after SAM intercept
    interceptG: number;
    interceptB: number;
    outlineR: number; // outline color (normal)
    outlineG: number;
    outlineB: number;
    interceptOutlineR: number; // outline color (after intercept)
    interceptOutlineG: number;
    interceptOutlineB: number;
    markerCircleRadius: number; // px — zone boundary circle size
    markerXRadius: number; // px — SAM intercept X size
  };
  nukeTelegraph: {
    strokeWidth: number; // world units — circle ring width
    dashLen: number; // world units — outer ring dash length
    gapLen: number; // world units — outer ring gap length
    rotationSpeed: number; // outer ring rotation speed
    baseAlpha: number; // base opacity (0–1)
    pulseAmplitude: number; // alpha pulse ±
    pulseSpeed: number; // pulse frequency (radians/sec)
    fillAlphaOffset: number; // inner fill is baseAlpha minus this
    colorR: number; // circle color — enemy nukes
    colorG: number;
    colorB: number;
    selfColorR: number; // circle color — own nukes
    selfColorG: number;
    selfColorB: number;
    allyColorR: number; // circle color — ally/teammate nukes
    allyColorG: number;
    allyColorB: number;
  };
  moveIndicator: {
    startRadius: number; // screen px — initial distance from center
    chevronSize: number; // screen px — wing span
    lineWidth: number; // screen px — stroke width
    duration: number; // ms — total animation lifetime
    converge: number; // 0–1 — fraction of radius consumed during animation
  };
  samRadius: {
    strokeWidth: number; // ring half-width in world units
    dashLen: number; // dash length in world units
    gapLen: number; // gap length in world units
    rotationSpeed: number; // world units per second
    alpha: number; // base opacity (0–1)
    outlineWidth: number; // outline border width in world units
    outlineSoftness: number; // smoothstep range (0 = hard, higher = softer)
  };
  bonusPopup: {
    scale: number;
    lifetimeMs: number;
    riseSpeed: number;
    yOffset: number;
    outlineWidth: number;
    colorR: number;
    colorG: number;
    colorB: number;
    minScreenScale: number; // minimum world-scale when zoomed out (prevents vanishing)
    cullZoom: number; // popups hidden below this zoom level
  };
  ghostCost: {
    screenScale: number; // screen-relative em scale; divided by zoom each frame for fixed on-screen size
    screenYOffset: number; // screen-relative downward offset from icon center; divided by zoom each frame for fixed on-screen gap
  };
  spawnOverlay: {
    highlightRadius: number; // tile highlight radius (squared internally)
    highlightAlpha: number; // tile highlight opacity (0–1)
    selfMinRad: number; // self ring inner radius
    selfMaxRad: number; // self ring outer radius
    mateMinRad: number; // teammate ring inner radius
    mateMaxRad: number; // teammate ring outer radius
    animSpeed: number; // breathing animation speed
    gradientInnerEdge: number; // static gradient inner ramp end (0–1)
    gradientSolidEnd: number; // static gradient solid band end (0–1)
  };
  smallPlayerGlow: {
    color: number[]; // RGB, each 0–1
    alpha: number; // peak opacity (0–1)
    pulseSpeed: number; // breath animation speed
  };
  altView: {
    gridFontSize: number;
    recolorStructures: boolean;
  };
  tileDrip: {
    /**
     * Round-robin bucket count for staggering territory tile uploads across
     * render frames. One bucket drains per frame at 60Hz. 12 ≈ 200ms max
     * latency, which absorbs a 100ms tick delay without a visible freeze.
     * Changing at runtime requires reload.
     */
    bucketCount: number;
  };
  lightConfigs: Record<string, { radius: number; intensity: number }>;
}

export type ThemeName = "default" | "colorblind";

// Typed so tsc validates each theme JSON against the ThemeSettings shape.
const THEMES: Record<ThemeName, ThemeSettings> = {
  default: defaultTheme,
  colorblind: colorblindTheme,
};

/** Create fresh theme settings with defaults from the named theme JSON. */
export function createThemeSettings(
  name: ThemeName = "default",
): ThemeSettings {
  return JSON.parse(JSON.stringify(THEMES[name])) as ThemeSettings;
}

/**
 * Create a fresh settings object: render-settings.json combined with the
 * active theme JSON.
 */
export function createRenderSettings(): RenderSettings {
  return {
    ...(JSON.parse(JSON.stringify(defaults)) as Omit<RenderSettings, "theme">),
    theme: createThemeSettings(),
  };
}

/** Dump current settings to a downloadable JSON file. */
export function dumpSettings(settings: RenderSettings): void {
  const json = JSON.stringify(settings, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "render-settings.json";
  a.click();
  URL.revokeObjectURL(url);
}
