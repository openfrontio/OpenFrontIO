import defaults from "./render-settings.json";

export interface RenderSettings {
  passEnabled: {
    terrain: boolean;
    mapOverlay: boolean;
    territoryPatterns: boolean;
    structure: boolean;
    unit: boolean;
    name: boolean;
    falloutBloom: boolean;
    railroad: boolean;
    fx: boolean;
    bar: boolean;
    nameDebug: boolean;
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
  dayNight: {
    mode: "light" | "dark";
    nightAmbient: number;
    dayAmbient: number;
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
  };
  railroad: {
    railMinZoom: number;
    railFadeRange: number;
    railDetailZoom: number;
    railAlpha: number;
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
  };
  structureLevel: {
    scale: number;
    outlineWidth: number;
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
    emojiRowOffset: number;
    statusRowOffset: number;
  };
  fx: {
    shockwaveRingWidth: number;
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
    colorR: number; // circle color
    colorG: number;
    colorB: number;
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

/** Create a fresh settings object with defaults from render-settings.json. */
export function createRenderSettings(): RenderSettings {
  return JSON.parse(JSON.stringify(defaults)) as RenderSettings;
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
