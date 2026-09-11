import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { MapLayer } from "../../core/game/TerrainMapLoader";
import {
  GRAPHICS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import { migrateLegacyGraphicsSettings } from "../GraphicsPresets";
import { type GraphicsOverrides } from "../render/gl";
import renderDefaults from "../render/gl/render-settings.json";
import { translateText } from "../Utils";
import "./baseComponents/setting/SettingColor";
import "./baseComponents/setting/SettingSlider";
import "./baseComponents/setting/SettingToggle";

const NAME_SCALE_MIN = 0.2;
const NAME_SCALE_MAX = 1.5;
const NAME_SCALE_STEP = 0.05;

const NAME_CULL_MIN = 0;
const NAME_CULL_MAX = 0.05;
const NAME_CULL_STEP = 0.001;

const HOVER_FADE_MIN = 0;
const HOVER_FADE_MAX = 1;
const HOVER_FADE_STEP = 0.05;

const HOVER_GLOW_WIDTH_MIN = 0;
const HOVER_GLOW_WIDTH_MAX = 8;
const HOVER_GLOW_WIDTH_STEP = 0.5;

const HOVER_GLOW_ALPHA_MIN = 0;
const HOVER_GLOW_ALPHA_MAX = 1;
const HOVER_GLOW_ALPHA_STEP = 0.05;

const ICON_SIZE_MIN = 40;
const ICON_SIZE_MAX = 70;
const ICON_SIZE_STEP = 5;

const HIGHLIGHT_FILL_MIN = 0;
const HIGHLIGHT_FILL_MAX = 1;
const HIGHLIGHT_FILL_STEP = 0.01;

const HIGHLIGHT_BRIGHTEN_MIN = 0;
const HIGHLIGHT_BRIGHTEN_MAX = 1;
const HIGHLIGHT_BRIGHTEN_STEP = 0.01;

const HIGHLIGHT_THICKEN_MIN = 0;
const HIGHLIGHT_THICKEN_MAX = 5;
const HIGHLIGHT_THICKEN_STEP = 1;

const TERRITORY_SAT_MIN = 0;
const TERRITORY_SAT_MAX = 1;
const TERRITORY_SAT_STEP = 0.01;

const TERRITORY_ALPHA_MIN = 0;
const TERRITORY_ALPHA_MAX = 1;
const TERRITORY_ALPHA_STEP = 0.01;

const ALT_VIEW_FILL_ALPHA_MIN = 0;
const ALT_VIEW_FILL_ALPHA_MAX = 1;
const ALT_VIEW_FILL_ALPHA_STEP = 0.01;

const COORDINATE_GRID_OPACITY_MIN = 0;
const COORDINATE_GRID_OPACITY_MAX = 1;
const COORDINATE_GRID_OPACITY_STEP = 0.01;

// Train track "draw distance" is presented inverted: a higher slider value means
// tracks stay visible when more zoomed out, i.e. a lower railMinZoom.
const RAIL_ZOOM_MIN = 0;
const RAIL_ZOOM_MAX = 10;
const RAIL_ZOOM_STEP = 0.1;

const RAIL_THICKNESS_MIN = 0.5;
const RAIL_THICKNESS_MAX = 3;
const RAIL_THICKNESS_STEP = 0.1;

const LAYER_ALPHA_MIN = 0;
const LAYER_ALPHA_MAX = 1;
const LAYER_ALPHA_STEP = 0.01;

// Small-player glow strength is shown as a percentage: 0% = off, 100% = the
// glow's full brightness.
const GLOW_STRENGTH_MIN = 0;
const GLOW_STRENGTH_MAX = 100;
const GLOW_STRENGTH_STEP = 5;

// "Ambient light" level shown to the player: 0 = no darkening (lighting off),
// 10 = darkest with the strongest glow. Mapped linearly onto the renderer's
// ambient value (1 = identity, AMBIENT_MIN = darkest).
const AMBIENT_LEVEL_MIN = 0;
const AMBIENT_LEVEL_MAX = 10;
const AMBIENT_LEVEL_STEP = 1;
const AMBIENT_MIN = 0.2;

function ambientSliderToValue(slider: number): number {
  return 1 - (slider / AMBIENT_LEVEL_MAX) * (1 - AMBIENT_MIN);
}

function ambientValueToSlider(ambient: number): number {
  const slider = ((1 - ambient) / (1 - AMBIENT_MIN)) * AMBIENT_LEVEL_MAX;
  return Math.round(
    Math.min(AMBIENT_LEVEL_MAX, Math.max(AMBIENT_LEVEL_MIN, slider)),
  );
}

// "Unit glow" level shown to the player: higher = more glow. It's the inverse
// of the renderer's falloffPower (lower power spreads the glow wider), mapped
// so 0 = tightest (FALLOFF_AT_MIN_GLOW) and 10 = widest (FALLOFF_AT_MAX_GLOW).
const UNIT_GLOW_MIN = 0;
const UNIT_GLOW_MAX = 10;
const UNIT_GLOW_STEP = 1;
const FALLOFF_AT_MIN_GLOW = 3;
const FALLOFF_AT_MAX_GLOW = 1;

function unitGlowSliderToFalloff(slider: number): number {
  return (
    FALLOFF_AT_MIN_GLOW -
    (slider / UNIT_GLOW_MAX) * (FALLOFF_AT_MIN_GLOW - FALLOFF_AT_MAX_GLOW)
  );
}

function falloffToUnitGlowSlider(falloff: number): number {
  const slider =
    ((FALLOFF_AT_MIN_GLOW - falloff) /
      (FALLOFF_AT_MIN_GLOW - FALLOFF_AT_MAX_GLOW)) *
    UNIT_GLOW_MAX;
  return Math.round(Math.min(UNIT_GLOW_MAX, Math.max(UNIT_GLOW_MIN, slider)));
}

const HEX_COLOR_RE = /^#?([0-9a-fA-F]{6})$/;

// The stale-nuke (fallout ground tint) color is stored in render-settings.json
// as three 0-1 floats; the color picker wants a "#rrggbb" hex string.
function rgbFloatsToHex(r: number, g: number, b: number): string {
  const ch = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

const NUKE_COLOR_DEFAULT = rgbFloatsToHex(
  renderDefaults.mapOverlay.staleNukeR,
  renderDefaults.mapOverlay.staleNukeG,
  renderDefaults.mapOverlay.staleNukeB,
);

/** Value read off a setting-slider / setting-color `change` event. */
function detailValue(event: Event): unknown {
  return (event as CustomEvent<{ value: unknown }>).detail?.value;
}

function sliderValue(event: Event): number | null {
  const value = detailValue(event);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Every fine-grained graphics option, as the Graphics tab's "Advanced" body.
 *
 * Self-contained like `graphics-preset-selector`: it reads and writes
 * `UserSettings` directly, so both the page and the in-game instance of the
 * settings modal get the same controls by dropping the element in.
 *
 * Live apply is not wired here and must not be. Every option below is stored
 * under the single `settings.graphics` key, and `ClientGameRunner` listens for
 * that key's change event to re-resolve the render settings and rebuild the
 * GPU-derived state — so a running game follows these controls with no
 * renderer reference on this component at all.
 *
 * The exception is map layers, whose control set comes from the running game's
 * map and whose visibility/alpha the renderer does not re-read from settings
 * after startup. Those arrive as `mapLayers` plus the two callbacks, set by
 * `GameRenderer` on the in-game instance only.
 */
@customElement("graphics-advanced-settings")
export class GraphicsAdvancedSettings extends LitElement {
  private readonly userSettings = new UserSettings();

  /** Map layers for the current game. Empty on the page instance. */
  @property({ attribute: false }) mapLayers: MapLayer[] = [];

  /** Callback to toggle layer visibility on the renderer. */
  @property({ attribute: false }) onLayerVisibilityChange:
    | ((layerId: string, visible: boolean) => void)
    | null = null;

  /** Callback to set layer alpha on the renderer. */
  @property({ attribute: false }) onLayerAlphaChange:
    | ((layerId: string, alpha: number) => void)
    | null = null;

  createRenderRoot() {
    return this;
  }

  // True only for the duration of this component's own write. Every write
  // below dispatches the change event this component also listens for, and a
  // self-triggered resync would re-push all layers on every slider drag.
  private writingOwnChange = false;

  connectedCallback() {
    super.connectedCallback();
    // Snapshot pre-preset custom settings before a preset or an import can
    // overwrite them wholesale. Idempotent, and a no-op once done.
    migrateLegacyGraphicsSettings(this.userSettings);
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      this.onExternalGraphicsChange,
    );
  }

  disconnectedCallback() {
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      this.onExternalGraphicsChange,
    );
    super.disconnectedCallback();
  }

  /**
   * Something else replaced the configuration — the preset dropdown, or an
   * import. Redraw so every control shows the new value, and re-push the map
   * layers: unlike the rest, the renderer does not re-read those from settings,
   * so a preset that changes them is otherwise applied everywhere but there.
   */
  private readonly onExternalGraphicsChange = () => {
    if (this.writingOwnChange) return;
    this.requestUpdate();
    this.syncLayerVisibility();
  };

  // ---- Override patching ----

  /** Write the graphics key, marking the change event it emits as our own. */
  private writeOverrides(value: GraphicsOverrides) {
    this.writingOwnChange = true;
    try {
      this.userSettings.setGraphicsOverrides(value);
    } finally {
      this.writingOwnChange = false;
    }
  }

  private patchName(patch: Partial<GraphicsOverrides["name"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      name: { ...current.name, ...patch },
    });
    this.requestUpdate();
  }

  private patchStructure(patch: Partial<GraphicsOverrides["structure"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      structure: { ...current.structure, ...patch },
    });
    this.requestUpdate();
  }

  private patchMapOverlay(patch: Partial<GraphicsOverrides["mapOverlay"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      mapOverlay: { ...current.mapOverlay, ...patch },
    });
    this.requestUpdate();
  }

  private patchAltView(patch: Partial<GraphicsOverrides["altView"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      altView: { ...current.altView, ...patch },
    });
    this.requestUpdate();
  }

  private patchRailroad(patch: Partial<GraphicsOverrides["railroad"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      railroad: { ...current.railroad, ...patch },
    });
    this.requestUpdate();
  }

  private patchTerrain(patch: Partial<GraphicsOverrides["terrain"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      terrain: { ...current.terrain, ...patch },
    });
    this.requestUpdate();
  }

  private patchLighting(patch: Partial<GraphicsOverrides["lighting"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      lighting: { ...current.lighting, ...patch },
    });
    this.requestUpdate();
  }

  private patchPassEnabled(patch: Partial<GraphicsOverrides["passEnabled"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      passEnabled: { ...current.passEnabled, ...patch },
    });
    this.requestUpdate();
  }

  private patchSmallPlayerGlow(
    patch: Partial<GraphicsOverrides["smallPlayerGlow"]>,
  ) {
    const current = this.userSettings.graphicsOverrides();
    this.writeOverrides({
      ...current,
      smallPlayerGlow: { ...current.smallPlayerGlow, ...patch },
    });
    this.requestUpdate();
  }

  // ---- Lighting ----

  private currentAmbientLevel(): number {
    const ambient =
      this.userSettings.graphicsOverrides().lighting?.ambient ??
      renderDefaults.lighting.ambient;
    return ambientValueToSlider(ambient);
  }

  private onAmbientLevelChange(event: Event) {
    const level = sliderValue(event);
    if (level === null) return;
    this.patchLighting({ ambient: ambientSliderToValue(level) });
  }

  private currentUnitGlow(): number {
    const falloff =
      this.userSettings.graphicsOverrides().lighting?.falloffPower ??
      renderDefaults.lighting.falloffPower;
    return falloffToUnitGlowSlider(falloff);
  }

  private onUnitGlowChange(event: Event) {
    const level = sliderValue(event);
    if (level === null) return;
    this.patchLighting({ falloffPower: unitGlowSliderToFalloff(level) });
  }

  // ---- Name labels ----

  private currentNameScale(): number {
    return (
      this.userSettings.graphicsOverrides().name?.nameScaleFactor ??
      renderDefaults.name.nameScaleFactor
    );
  }

  private currentNameCull(): number {
    return (
      this.userSettings.graphicsOverrides().name?.cullThreshold ??
      renderDefaults.name.cullThreshold
    );
  }

  private currentHoverFade(): number {
    return (
      this.userSettings.graphicsOverrides().name?.hoverFadeAlpha ??
      renderDefaults.name.hoverFadeAlpha
    );
  }

  private currentHoverGlowWidth(): number {
    return (
      this.userSettings.graphicsOverrides().name?.hoverGlowWidth ??
      renderDefaults.name.hoverGlowWidth
    );
  }

  private currentHoverGlowAlpha(): number {
    return (
      this.userSettings.graphicsOverrides().name?.hoverGlowAlpha ??
      renderDefaults.name.hoverGlowAlpha
    );
  }

  private currentDarkNames(): boolean {
    return (
      this.userSettings.graphicsOverrides().name?.darkNames ??
      !renderDefaults.name.fillUsePlayerColor
    );
  }

  private onNameScaleChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchName({ nameScaleFactor: value });
  }

  private onNameCullChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchName({ cullThreshold: value });
  }

  private onHoverFadeChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchName({ hoverFadeAlpha: value });
  }

  private onHoverGlowWidthChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchName({ hoverGlowWidth: value });
  }

  private onHoverGlowAlphaChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchName({ hoverGlowAlpha: value });
  }

  private onToggleNamesColored() {
    this.patchName({ darkNames: !this.currentDarkNames() });
  }

  // ---- Structure icons ----

  private currentIconSize(): number {
    return (
      this.userSettings.graphicsOverrides().structure?.iconSize ??
      renderDefaults.structure.iconSize
    );
  }

  private onIconSizeChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchStructure({ iconSize: value });
  }

  private currentClassicIcons(): boolean {
    return (
      this.userSettings.graphicsOverrides().structure?.classicIcons ?? true
    );
  }

  private onToggleClassicIcons() {
    this.patchStructure({ classicIcons: !this.currentClassicIcons() });
  }

  private currentClassicNumbers(): boolean {
    return (
      this.userSettings.graphicsOverrides().structure?.classicNumbers ?? true
    );
  }

  private onToggleClassicNumbers() {
    this.patchStructure({ classicNumbers: !this.currentClassicNumbers() });
  }

  private currentShowDots(): boolean {
    return this.userSettings.graphicsOverrides().structure?.showDots ?? true;
  }

  private onToggleShowDots() {
    this.patchStructure({ showDots: !this.currentShowDots() });
  }

  // ---- Map ----

  private currentNavalHighlight(): boolean {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.navalHighlight ??
      renderDefaults.mapOverlay.navalHighlight
    );
  }

  private onToggleNavalHighlight() {
    this.patchMapOverlay({ navalHighlight: !this.currentNavalHighlight() });
  }

  private currentHighlightFill(): number {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.highlightFillBrighten ??
      renderDefaults.mapOverlay.highlightFillBrighten
    );
  }

  private currentHighlightBrighten(): number {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.highlightBrighten ??
      renderDefaults.mapOverlay.highlightBrighten
    );
  }

  private currentHighlightThicken(): number {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.highlightThicken ??
      renderDefaults.mapOverlay.highlightThicken
    );
  }

  private currentTerritorySat(): number {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.territorySaturation ??
      renderDefaults.mapOverlay.territorySaturation
    );
  }

  private currentTerritoryAlpha(): number {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.territoryAlpha ??
      renderDefaults.mapOverlay.territoryAlpha
    );
  }

  private currentAltViewFillAlpha(): number {
    return (
      this.userSettings.graphicsOverrides().altView?.fillAlpha ??
      renderDefaults.altView.fillAlpha
    );
  }

  private currentCoordinateGridOpacity(): number {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.coordinateGridOpacity ??
      renderDefaults.mapOverlay.coordinateGridOpacity
    );
  }

  private currentRailMinZoom(): number {
    return (
      this.userSettings.graphicsOverrides().railroad?.railMinZoom ??
      renderDefaults.railroad.railMinZoom
    );
  }

  private currentRailThickness(): number {
    return (
      this.userSettings.graphicsOverrides().railroad?.railThickness ??
      renderDefaults.railroad.railThickness
    );
  }

  private onHighlightFillChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchMapOverlay({ highlightFillBrighten: value });
  }

  private onHighlightBrightenChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchMapOverlay({ highlightBrighten: value });
  }

  private onHighlightThickenChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchMapOverlay({ highlightThicken: value });
  }

  private onTerritorySatChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchMapOverlay({ territorySaturation: value });
  }

  private onTerritoryAlphaChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchMapOverlay({ territoryAlpha: value });
  }

  private onAltViewFillAlphaChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchAltView({ fillAlpha: value });
  }

  private onCoordinateGridOpacityChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchMapOverlay({ coordinateGridOpacity: value });
  }

  private onRailDrawDistanceChange(event: Event) {
    const drawDistance = sliderValue(event);
    if (drawDistance === null) return;
    // Invert: higher draw distance => tracks visible when more zoomed out.
    this.patchRailroad({ railMinZoom: RAIL_ZOOM_MAX - drawDistance });
  }

  private onRailThicknessChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchRailroad({ railThickness: value });
  }

  // ---- Map-layer visibility ----

  private isLayerVisible(layerId: string): boolean {
    const overrides = this.userSettings.graphicsOverrides();
    // Default to visible if no override is set.
    return overrides.mapLayerVisibility?.[layerId] ?? true;
  }

  private layerName(layerId: string): string {
    const key = `map_layers.${layerId}`;
    const translated = translateText(key);
    // translateText returns the key itself when the translation is missing.
    return translated === key ? layerId : translated;
  }

  private onToggleLayer(layerId: string) {
    const current = this.userSettings.graphicsOverrides();
    const currentVis = current.mapLayerVisibility ?? {};
    const newVis = { ...currentVis, [layerId]: !this.isLayerVisible(layerId) };
    this.writeOverrides({
      ...current,
      mapLayerVisibility: newVis,
    });
    this.onLayerVisibilityChange?.(layerId, newVis[layerId]);
    this.requestUpdate();
  }

  /**
   * Re-apply layer visibility from current overrides to the renderer.
   * Called after reset or preset import so the WebGL passes stay in sync.
   */
  private syncLayerVisibility() {
    for (const layer of this.mapLayers) {
      this.onLayerVisibilityChange?.(layer.id, this.isLayerVisible(layer.id));
    }
    this.syncLayerAlpha();
  }

  // ---- Map-layer alpha ----

  private getLayerAlpha(layerId: string, manifestDefault?: number): number {
    const overrides = this.userSettings.graphicsOverrides();
    const alpha = overrides.mapLayerAlpha?.[layerId];
    if (alpha !== undefined) return alpha;
    return manifestDefault ?? 1;
  }

  private onLayerAlphaSliderChange(layerId: string, event: Event) {
    const alpha = sliderValue(event);
    if (alpha === null) return;
    const current = this.userSettings.graphicsOverrides();
    const currentAlpha = current.mapLayerAlpha ?? {};
    this.writeOverrides({
      ...current,
      mapLayerAlpha: { ...currentAlpha, [layerId]: alpha },
    });
    this.onLayerAlphaChange?.(layerId, alpha);
    this.requestUpdate();
  }

  /**
   * Re-apply layer alpha from current overrides to the renderer.
   * Called after reset or preset import so the WebGL passes stay in sync.
   */
  private syncLayerAlpha() {
    for (const layer of this.mapLayers) {
      this.onLayerAlphaChange?.(
        layer.id,
        this.getLayerAlpha(layer.id, layer.alpha),
      );
    }
  }

  // ---- Terrain colors ----

  private currentBackgroundColor(): string {
    return (
      this.userSettings.graphicsOverrides().terrain?.backgroundColor ??
      renderDefaults.terrain.backgroundColor
    );
  }

  private currentOceanColor(): string {
    return (
      this.userSettings.graphicsOverrides().terrain?.oceanColor ??
      renderDefaults.terrain.oceanColor
    );
  }

  private currentSandColor(): string {
    return (
      this.userSettings.graphicsOverrides().terrain?.sandColor ??
      renderDefaults.terrain.sandColor
    );
  }

  private currentPlainsColor(): string {
    return (
      this.userSettings.graphicsOverrides().terrain?.plainsColor ??
      renderDefaults.terrain.plainsColor
    );
  }

  private currentHighlandColor(): string {
    return (
      this.userSettings.graphicsOverrides().terrain?.highlandColor ??
      renderDefaults.terrain.highlandColor
    );
  }

  private currentMountainColor(): string {
    return (
      this.userSettings.graphicsOverrides().terrain?.mountainColor ??
      renderDefaults.terrain.mountainColor
    );
  }

  private currentNukeColor(): string {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.staleNukeColor ??
      NUKE_COLOR_DEFAULT
    );
  }

  /** Normalizes a picker value, ignoring partial/invalid hex while typing. */
  private static normalizeHex(event: Event): string | null {
    const value = detailValue(event);
    if (typeof value !== "string") return null;
    const match = HEX_COLOR_RE.exec(value.trim());
    if (match === null) return null;
    return `#${match[1].toLowerCase()}`;
  }

  private onBackgroundColorChange(event: Event) {
    const hex = GraphicsAdvancedSettings.normalizeHex(event);
    if (hex === null) return;
    this.patchTerrain({ backgroundColor: hex });
  }

  private onOceanColorChange(event: Event) {
    const hex = GraphicsAdvancedSettings.normalizeHex(event);
    if (hex === null) return;
    this.patchTerrain({ oceanColor: hex });
  }

  private onSandColorChange(event: Event) {
    const hex = GraphicsAdvancedSettings.normalizeHex(event);
    if (hex === null) return;
    this.patchTerrain({ sandColor: hex });
  }

  private onPlainsColorChange(event: Event) {
    const hex = GraphicsAdvancedSettings.normalizeHex(event);
    if (hex === null) return;
    this.patchTerrain({ plainsColor: hex });
  }

  private onHighlandColorChange(event: Event) {
    const hex = GraphicsAdvancedSettings.normalizeHex(event);
    if (hex === null) return;
    this.patchTerrain({ highlandColor: hex });
  }

  private onMountainColorChange(event: Event) {
    const hex = GraphicsAdvancedSettings.normalizeHex(event);
    if (hex === null) return;
    this.patchTerrain({ mountainColor: hex });
  }

  private onNukeColorChange(event: Event) {
    const hex = GraphicsAdvancedSettings.normalizeHex(event);
    if (hex === null) return;
    this.patchMapOverlay({ staleNukeColor: hex });
  }

  // ---- Effects ----

  private currentSpecialEffects(): boolean {
    return (
      this.userSettings.graphicsOverrides().passEnabled?.fx ??
      renderDefaults.passEnabled.fx
    );
  }

  private onToggleSpecialEffects() {
    this.patchPassEnabled({ fx: !this.currentSpecialEffects() });
  }

  private currentFallout(): boolean {
    return (
      this.userSettings.graphicsOverrides().passEnabled?.fallout ??
      renderDefaults.passEnabled.falloutBloom
    );
  }

  private onToggleFallout() {
    this.patchPassEnabled({ fallout: !this.currentFallout() });
  }

  private currentGlowStrength(): number {
    return (
      this.userSettings.graphicsOverrides().smallPlayerGlow?.strength ??
      renderDefaults.smallPlayerGlow.strength
    );
  }

  private onGlowStrengthChange(event: Event) {
    const value = sliderValue(event);
    if (value === null) return;
    this.patchSmallPlayerGlow({ strength: value / 100 });
  }

  // ---- Reset ----

  private onResetClick() {
    this.writeOverrides({});
    this.syncLayerVisibility();
    this.requestUpdate();
  }

  // ---- Rendering ----

  private static section(labelKey: string) {
    return html`<div
      class="text-white/60 text-xs font-semibold uppercase tracking-wider px-1 pt-3"
    >
      ${translateText(labelKey)}
    </div>`;
  }

  /**
   * Map layers, or nothing at all off a running game.
   *
   * Hidden rather than disabled: the rows are enumerated from the current
   * map's layer manifest, so with no game there is no list to grey out — a
   * disabled section here would be an empty box with a heading over it.
   */
  private renderMapLayers() {
    if (this.mapLayers.length === 0) return nothing;
    return html`
      <div data-map-layers>
        ${GraphicsAdvancedSettings.section(
          "graphics_setting.section_map_layers",
        )}
        ${this.mapLayers.map((layer) => {
          const alpha = this.getLayerAlpha(layer.id, layer.alpha);
          return html`
            <div class="flex flex-col gap-2">
              <setting-toggle
                label=${this.layerName(layer.id)}
                description=${`${
                  layer.placement === "land"
                    ? translateText("graphics_setting.layer_placement_land")
                    : translateText("graphics_setting.layer_placement_water")
                }${
                  layer.nukeable
                    ? ` · ${translateText("graphics_setting.layer_nukeable")}`
                    : ""
                }`}
                id=${`map-layer-${layer.id}-toggle`}
                .checked=${this.isLayerVisible(layer.id)}
                @change=${() => this.onToggleLayer(layer.id)}
              ></setting-toggle>
              ${this.isLayerVisible(layer.id)
                ? html`<setting-slider
                    label=${`${this.layerName(layer.id)} — ${translateText("graphics_setting.layer_alpha_label")}`}
                    description=""
                    id=${`map-layer-${layer.id}-alpha-slider`}
                    min=${LAYER_ALPHA_MIN}
                    max=${LAYER_ALPHA_MAX}
                    step=${LAYER_ALPHA_STEP}
                    unit=""
                    .formatValue=${(v: number) => v.toFixed(2)}
                    .value=${alpha}
                    @change=${(e: Event) =>
                      this.onLayerAlphaSliderChange(layer.id, e)}
                  ></setting-slider>`
                : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }

  render() {
    const twoDecimals = (v: number) => v.toFixed(2);
    const threeDecimals = (v: number) => v.toFixed(3);
    const oneDecimal = (v: number) => v.toFixed(1);
    const whole = (v: number) => String(Math.round(v));

    return html`
      <!-- 💡 Lighting -->
      ${GraphicsAdvancedSettings.section("graphics_setting.section_lighting")}
      <setting-slider
        label=${translateText("graphics_setting.lighting_ambient_label")}
        description=${translateText("graphics_setting.lighting_ambient_desc")}
        id="ambient-light-slider"
        min=${AMBIENT_LEVEL_MIN}
        max=${AMBIENT_LEVEL_MAX}
        step=${AMBIENT_LEVEL_STEP}
        unit=""
        .formatValue=${whole}
        .value=${this.currentAmbientLevel()}
        @change=${this.onAmbientLevelChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.lighting_unit_glow_label")}
        description=${translateText("graphics_setting.lighting_unit_glow_desc")}
        id="unit-glow-slider"
        min=${UNIT_GLOW_MIN}
        max=${UNIT_GLOW_MAX}
        step=${UNIT_GLOW_STEP}
        unit=""
        .formatValue=${whole}
        .value=${this.currentUnitGlow()}
        @change=${this.onUnitGlowChange}
      ></setting-slider>

      <!-- 🏷️ Name labels -->
      ${GraphicsAdvancedSettings.section(
        "graphics_setting.section_name_labels",
      )}
      <setting-slider
        label=${translateText("graphics_setting.name_scale_label")}
        description=""
        id="name-scale-slider"
        min=${NAME_SCALE_MIN}
        max=${NAME_SCALE_MAX}
        step=${NAME_SCALE_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentNameScale()}
        @change=${this.onNameScaleChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.name_cull_label")}
        description=${translateText("graphics_setting.name_cull_desc")}
        id="name-cull-slider"
        min=${NAME_CULL_MIN}
        max=${NAME_CULL_MAX}
        step=${NAME_CULL_STEP}
        unit=""
        .formatValue=${threeDecimals}
        .value=${this.currentNameCull()}
        @change=${this.onNameCullChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.hover_fade_label")}
        description=${translateText("graphics_setting.hover_fade_desc")}
        id="hover-fade-slider"
        min=${HOVER_FADE_MIN}
        max=${HOVER_FADE_MAX}
        step=${HOVER_FADE_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentHoverFade()}
        @change=${this.onHoverFadeChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.hover_glow_width_label")}
        description=${translateText("graphics_setting.hover_glow_width_desc")}
        id="hover-glow-width-slider"
        min=${HOVER_GLOW_WIDTH_MIN}
        max=${HOVER_GLOW_WIDTH_MAX}
        step=${HOVER_GLOW_WIDTH_STEP}
        unit=""
        .formatValue=${oneDecimal}
        .value=${this.currentHoverGlowWidth()}
        @change=${this.onHoverGlowWidthChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.hover_glow_alpha_label")}
        description=${translateText("graphics_setting.hover_glow_alpha_desc")}
        id="hover-glow-alpha-slider"
        min=${HOVER_GLOW_ALPHA_MIN}
        max=${HOVER_GLOW_ALPHA_MAX}
        step=${HOVER_GLOW_ALPHA_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentHoverGlowAlpha()}
        @change=${this.onHoverGlowAlphaChange}
      ></setting-slider>

      <setting-toggle
        label=${translateText("graphics_setting.colored_names_label")}
        description=${translateText("graphics_setting.colored_names_desc")}
        id="colored-names-toggle"
        .checked=${!this.currentDarkNames()}
        @change=${this.onToggleNamesColored}
      ></setting-toggle>

      <!-- 🏰 Structure icons -->
      ${GraphicsAdvancedSettings.section(
        "graphics_setting.section_structure_icons",
      )}
      <setting-slider
        label=${translateText("graphics_setting.icon_size_label")}
        description=${translateText("graphics_setting.icon_size_desc")}
        id="icon-size-slider"
        min=${ICON_SIZE_MIN}
        max=${ICON_SIZE_MAX}
        step=${ICON_SIZE_STEP}
        unit=""
        .formatValue=${whole}
        .value=${this.currentIconSize()}
        @change=${this.onIconSizeChange}
      ></setting-slider>

      <setting-toggle
        label=${translateText("graphics_setting.classic_icons_label")}
        description=${translateText("graphics_setting.classic_icons_desc")}
        id="classic-icons-toggle"
        .checked=${this.currentClassicIcons()}
        @change=${this.onToggleClassicIcons}
      ></setting-toggle>

      <setting-toggle
        label=${translateText("graphics_setting.classic_numbers_label")}
        description=${translateText("graphics_setting.classic_numbers_desc")}
        id="classic-numbers-toggle"
        .checked=${this.currentClassicNumbers()}
        @change=${this.onToggleClassicNumbers}
      ></setting-toggle>

      <setting-toggle
        label=${translateText("graphics_setting.structure_dots_label")}
        description=${translateText("graphics_setting.structure_dots_desc")}
        id="structure-dots-toggle"
        .checked=${this.currentShowDots()}
        @change=${this.onToggleShowDots}
      ></setting-toggle>

      <!-- 🗺️ Map -->
      ${GraphicsAdvancedSettings.section("graphics_setting.section_map")}
      <setting-toggle
        label=${translateText("graphics_setting.naval_hover_highlight_label")}
        description=${translateText(
          "graphics_setting.naval_hover_highlight_desc",
        )}
        id="naval-highlight-toggle"
        .checked=${this.currentNavalHighlight()}
        @change=${this.onToggleNavalHighlight}
      ></setting-toggle>

      <setting-slider
        label=${translateText("graphics_setting.highlight_fill_label")}
        description=${translateText("graphics_setting.highlight_fill_desc")}
        id="highlight-fill-slider"
        min=${HIGHLIGHT_FILL_MIN}
        max=${HIGHLIGHT_FILL_MAX}
        step=${HIGHLIGHT_FILL_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentHighlightFill()}
        @change=${this.onHighlightFillChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.highlight_brighten_label")}
        description=${translateText("graphics_setting.highlight_brighten_desc")}
        id="highlight-brighten-slider"
        min=${HIGHLIGHT_BRIGHTEN_MIN}
        max=${HIGHLIGHT_BRIGHTEN_MAX}
        step=${HIGHLIGHT_BRIGHTEN_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentHighlightBrighten()}
        @change=${this.onHighlightBrightenChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.highlight_thicken_label")}
        description=${translateText("graphics_setting.highlight_thicken_desc")}
        id="highlight-thicken-slider"
        min=${HIGHLIGHT_THICKEN_MIN}
        max=${HIGHLIGHT_THICKEN_MAX}
        step=${HIGHLIGHT_THICKEN_STEP}
        unit=""
        .formatValue=${whole}
        .value=${this.currentHighlightThicken()}
        @change=${this.onHighlightThickenChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.territory_sat_label")}
        description=${translateText("graphics_setting.territory_sat_desc")}
        id="territory-saturation-slider"
        min=${TERRITORY_SAT_MIN}
        max=${TERRITORY_SAT_MAX}
        step=${TERRITORY_SAT_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentTerritorySat()}
        @change=${this.onTerritorySatChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.territory_alpha_label")}
        description=${translateText("graphics_setting.territory_alpha_desc")}
        id="territory-alpha-slider"
        min=${TERRITORY_ALPHA_MIN}
        max=${TERRITORY_ALPHA_MAX}
        step=${TERRITORY_ALPHA_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentTerritoryAlpha()}
        @change=${this.onTerritoryAlphaChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.alt_view_fill_alpha_label")}
        description=${translateText(
          "graphics_setting.alt_view_fill_alpha_desc",
        )}
        id="alt-view-fill-alpha-slider"
        min=${ALT_VIEW_FILL_ALPHA_MIN}
        max=${ALT_VIEW_FILL_ALPHA_MAX}
        step=${ALT_VIEW_FILL_ALPHA_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentAltViewFillAlpha()}
        @change=${this.onAltViewFillAlphaChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.coordinate_grid_opacity_label")}
        description=${translateText(
          "graphics_setting.coordinate_grid_opacity_desc",
        )}
        id="coordinate-grid-opacity-slider"
        min=${COORDINATE_GRID_OPACITY_MIN}
        max=${COORDINATE_GRID_OPACITY_MAX}
        step=${COORDINATE_GRID_OPACITY_STEP}
        unit=""
        .formatValue=${twoDecimals}
        .value=${this.currentCoordinateGridOpacity()}
        @change=${this.onCoordinateGridOpacityChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.rail_distance_label")}
        description=${translateText("graphics_setting.rail_distance_desc")}
        id="rail-distance-slider"
        min=${RAIL_ZOOM_MIN}
        max=${RAIL_ZOOM_MAX}
        step=${RAIL_ZOOM_STEP}
        unit=""
        .formatValue=${oneDecimal}
        .value=${RAIL_ZOOM_MAX - this.currentRailMinZoom()}
        @change=${this.onRailDrawDistanceChange}
      ></setting-slider>

      <setting-slider
        label=${translateText("graphics_setting.rail_thickness_label")}
        description=${translateText("graphics_setting.rail_thickness_desc")}
        id="rail-thickness-slider"
        min=${RAIL_THICKNESS_MIN}
        max=${RAIL_THICKNESS_MAX}
        step=${RAIL_THICKNESS_STEP}
        unit=""
        .formatValue=${oneDecimal}
        .value=${this.currentRailThickness()}
        @change=${this.onRailThicknessChange}
      ></setting-slider>

      ${this.renderMapLayers()}

      <!-- ⛰️ Terrain -->
      ${GraphicsAdvancedSettings.section("graphics_setting.section_terrain")}
      <setting-color
        label=${translateText("graphics_setting.background_color_label")}
        description=${translateText("graphics_setting.background_color_desc")}
        id="background-color-picker"
        .value=${this.currentBackgroundColor()}
        @change=${this.onBackgroundColorChange}
      ></setting-color>

      <setting-color
        label=${translateText("graphics_setting.ocean_color_label")}
        description=${translateText("graphics_setting.ocean_color_desc")}
        id="ocean-color-picker"
        .value=${this.currentOceanColor()}
        @change=${this.onOceanColorChange}
      ></setting-color>

      <setting-color
        label=${translateText("graphics_setting.sand_color_label")}
        description=${translateText("graphics_setting.sand_color_desc")}
        id="sand-color-picker"
        .value=${this.currentSandColor()}
        @change=${this.onSandColorChange}
      ></setting-color>

      <setting-color
        label=${translateText("graphics_setting.plains_color_label")}
        description=${translateText("graphics_setting.plains_color_desc")}
        id="plains-color-picker"
        .value=${this.currentPlainsColor()}
        @change=${this.onPlainsColorChange}
      ></setting-color>

      <setting-color
        label=${translateText("graphics_setting.highland_color_label")}
        description=${translateText("graphics_setting.highland_color_desc")}
        id="highland-color-picker"
        .value=${this.currentHighlandColor()}
        @change=${this.onHighlandColorChange}
      ></setting-color>

      <setting-color
        label=${translateText("graphics_setting.mountain_color_label")}
        description=${translateText("graphics_setting.mountain_color_desc")}
        id="mountain-color-picker"
        .value=${this.currentMountainColor()}
        @change=${this.onMountainColorChange}
      ></setting-color>

      <setting-color
        label=${translateText("graphics_setting.nuke_color_label")}
        description=${translateText("graphics_setting.nuke_color_desc")}
        id="nuke-color-picker"
        .value=${this.currentNukeColor()}
        @change=${this.onNukeColorChange}
      ></setting-color>

      <!-- ✨ Effects -->
      ${GraphicsAdvancedSettings.section("graphics_setting.section_effects")}
      <setting-toggle
        label=${translateText("user_setting.special_effects_label")}
        description=${translateText("user_setting.special_effects_desc")}
        id="special-effects-toggle"
        .checked=${this.currentSpecialEffects()}
        @change=${this.onToggleSpecialEffects}
      ></setting-toggle>

      <setting-toggle
        label=${translateText("graphics_setting.fallout_label")}
        description=${translateText("graphics_setting.fallout_desc")}
        id="fallout-toggle"
        .checked=${this.currentFallout()}
        @change=${this.onToggleFallout}
      ></setting-toggle>

      <setting-slider
        label=${translateText("user_setting.highlight_glow_strength_label")}
        description=${translateText(
          "user_setting.highlight_small_players_desc",
        )}
        id="glow-strength-slider"
        min=${GLOW_STRENGTH_MIN}
        max=${GLOW_STRENGTH_MAX}
        step=${GLOW_STRENGTH_STEP}
        .value=${Math.round(this.currentGlowStrength() * 100)}
        @change=${this.onGlowStrengthChange}
      ></setting-slider>

      <button
        id="graphics-reset"
        class="flex flex-col items-start w-full p-4 mt-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all text-left"
        @click=${this.onResetClick}
      >
        <div class="text-white font-bold text-base block mb-1">
          ${translateText("graphics_setting.reset_label")}
        </div>
        <div class="text-white/50 text-sm leading-snug">
          ${translateText("graphics_setting.reset_desc")}
        </div>
      </button>
    `;
  }
}
