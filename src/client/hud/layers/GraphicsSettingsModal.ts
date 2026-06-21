import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { crazyGamesSDK } from "src/client/CrazyGamesSDK";
import { PauseGameIntentEvent } from "src/client/Transport";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import type { GraphicsOverrides } from "../../render/gl";
import renderDefaults from "../../render/gl/render-settings.json";

const settingsIcon = assetUrl("images/SettingIconWhite.svg");

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

export class ShowGraphicsSettingsModalEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
}

@customElement("graphics-settings-modal")
export class GraphicsSettingsModal extends LitElement implements Controller {
  public eventBus: EventBus;
  public userSettings: UserSettings;

  @state()
  private isVisible: boolean = false;

  @query(".modal-overlay")
  private modalOverlay!: HTMLElement;

  @property({ type: Boolean })
  shouldPause = false;

  @property({ type: Boolean })
  wasPausedWhenOpened = false;

  init() {
    this.eventBus.on(ShowGraphicsSettingsModalEvent, (event) => {
      this.isVisible = event.isVisible;
      this.shouldPause = event.shouldPause;
      this.wasPausedWhenOpened = event.isPaused;
      this.pauseGame(true);
      this.requestUpdate();
    });
  }

  private pauseGame(pause: boolean) {
    if (this.shouldPause && !this.wasPausedWhenOpened) {
      if (pause) {
        crazyGamesSDK.gameplayStop();
      } else {
        crazyGamesSDK.gameplayStart();
      }
      this.eventBus.emit(new PauseGameIntentEvent(pause));
    }
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("click", this.handleOutsideClick, true);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("click", this.handleOutsideClick, true);
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleOutsideClick = (event: MouseEvent) => {
    if (
      this.isVisible &&
      this.modalOverlay &&
      event.target === this.modalOverlay
    ) {
      this.closeModal();
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.isVisible && event.key === "Escape") {
      this.closeModal();
    }
  };

  public closeModal() {
    this.isVisible = false;
    this.requestUpdate();
    this.pauseGame(false);
  }

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

  private patchName(patch: Partial<GraphicsOverrides["name"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      name: { ...current.name, ...patch },
    });
    this.requestUpdate();
  }

  private patchStructure(patch: Partial<GraphicsOverrides["structure"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      structure: { ...current.structure, ...patch },
    });
    this.requestUpdate();
  }

  private patchMapOverlay(patch: Partial<GraphicsOverrides["mapOverlay"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      mapOverlay: { ...current.mapOverlay, ...patch },
    });
    this.requestUpdate();
  }

  private patchRailroad(patch: Partial<GraphicsOverrides["railroad"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      railroad: { ...current.railroad, ...patch },
    });
    this.requestUpdate();
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
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchMapOverlay({ highlightFillBrighten: value });
  }

  private onHighlightBrightenChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchMapOverlay({ highlightBrighten: value });
  }

  private onHighlightThickenChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchMapOverlay({ highlightThicken: value });
  }

  private onTerritorySatChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchMapOverlay({ territorySaturation: value });
  }

  private onTerritoryAlphaChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchMapOverlay({ territoryAlpha: value });
  }

  private onCoordinateGridOpacityChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchMapOverlay({ coordinateGridOpacity: value });
  }

  private currentNukeColor(): string {
    return (
      this.userSettings.graphicsOverrides().mapOverlay?.staleNukeColor ??
      NUKE_COLOR_DEFAULT
    );
  }

  private onNukeColorChange(event: Event) {
    const value = (event.target as HTMLInputElement).value.trim();
    const match = HEX_COLOR_RE.exec(value);
    if (!match) return; // ignore partial/invalid hex while typing
    this.patchMapOverlay({ staleNukeColor: `#${match[1].toLowerCase()}` });
  }

  private onRailDrawDistanceChange(event: Event) {
    const drawDistance = parseFloat((event.target as HTMLInputElement).value);
    // Invert: higher draw distance => tracks visible when more zoomed out.
    this.patchRailroad({ railMinZoom: RAIL_ZOOM_MAX - drawDistance });
  }

  private onRailThicknessChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchRailroad({ railThickness: value });
  }

  private currentIconSize(): number {
    return (
      this.userSettings.graphicsOverrides().structure?.iconSize ??
      renderDefaults.structure.iconSize
    );
  }

  private onIconSizeChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchStructure({ iconSize: value });
  }

  private patchTerrain(patch: Partial<GraphicsOverrides["terrain"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      terrain: { ...current.terrain, ...patch },
    });
    this.requestUpdate();
  }

  private currentOceanColor(): string {
    return (
      this.userSettings.graphicsOverrides().terrain?.oceanColor ??
      renderDefaults.terrain.oceanColor
    );
  }

  private onOceanColorChange(event: Event) {
    const value = (event.target as HTMLInputElement).value.trim();
    const match = HEX_COLOR_RE.exec(value);
    if (!match) return; // ignore partial/invalid hex while typing
    this.patchTerrain({ oceanColor: `#${match[1].toLowerCase()}` });
  }

  private patchLighting(patch: Partial<GraphicsOverrides["lighting"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      lighting: { ...current.lighting, ...patch },
    });
    this.requestUpdate();
  }

  private currentAmbientLevel(): number {
    const ambient =
      this.userSettings.graphicsOverrides().lighting?.ambient ??
      renderDefaults.lighting.ambient;
    return ambientValueToSlider(ambient);
  }

  private onAmbientLevelChange(event: Event) {
    const level = parseFloat((event.target as HTMLInputElement).value);
    this.patchLighting({ ambient: ambientSliderToValue(level) });
  }

  private currentUnitGlow(): number {
    const falloff =
      this.userSettings.graphicsOverrides().lighting?.falloffPower ??
      renderDefaults.lighting.falloffPower;
    return falloffToUnitGlowSlider(falloff);
  }

  private onUnitGlowChange(event: Event) {
    const level = parseFloat((event.target as HTMLInputElement).value);
    this.patchLighting({ falloffPower: unitGlowSliderToFalloff(level) });
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

  private patchPassEnabled(patch: Partial<GraphicsOverrides["passEnabled"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      passEnabled: { ...current.passEnabled, ...patch },
    });
    this.requestUpdate();
  }

  /** Merge a patch into the accessibility graphics overrides and persist it. */
  private patchAccessibility(
    patch: Partial<GraphicsOverrides["accessibility"]>,
  ) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      accessibility: { ...current.accessibility, ...patch },
    });
    this.requestUpdate();
  }

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

  /** Whether colorblind mode is currently enabled. */
  private currentColorblind(): boolean {
    return (
      this.userSettings.graphicsOverrides().accessibility?.colorblind ?? false
    );
  }

  /** Toggle colorblind-friendly colors. */
  private onToggleColorblind() {
    this.patchAccessibility({ colorblind: !this.currentColorblind() });
  }

  private onNameScaleChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ nameScaleFactor: value });
  }

  private onNameCullChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ cullThreshold: value });
  }

  private onHoverFadeChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ hoverFadeAlpha: value });
  }

  private onHoverGlowWidthChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ hoverGlowWidth: value });
  }

  private onHoverGlowAlphaChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ hoverGlowAlpha: value });
  }

  private currentDarkNames(): boolean {
    return (
      this.userSettings.graphicsOverrides().name?.darkNames ??
      !renderDefaults.name.fillUsePlayerColor
    );
  }

  private onToggleNamesColored() {
    this.patchName({ darkNames: !this.currentDarkNames() });
  }

  private onResetClick() {
    this.userSettings.setGraphicsOverrides({});
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) return null;

    const nameScale = this.currentNameScale();
    const nameCull = this.currentNameCull();
    const hoverFade = this.currentHoverFade();
    const hoverGlowWidth = this.currentHoverGlowWidth();
    const hoverGlowAlpha = this.currentHoverGlowAlpha();
    const namesColored = !this.currentDarkNames();
    const iconSize = this.currentIconSize();
    const classicIcons = this.currentClassicIcons();
    const classicNumbers = this.currentClassicNumbers();
    const highlightFill = this.currentHighlightFill();
    const highlightBrighten = this.currentHighlightBrighten();
    const highlightThicken = this.currentHighlightThicken();
    const territorySat = this.currentTerritorySat();
    const territoryAlpha = this.currentTerritoryAlpha();
    const coordinateGridOpacity = this.currentCoordinateGridOpacity();
    const railDrawDistance = RAIL_ZOOM_MAX - this.currentRailMinZoom();
    const railThickness = this.currentRailThickness();
    const oceanColor = this.currentOceanColor();
    const nukeColor = this.currentNukeColor();
    const ambientLevel = this.currentAmbientLevel();
    const unitGlow = this.currentUnitGlow();
    const colorblind = this.currentColorblind();

    return html`
      <div
        class="modal-overlay fixed inset-0 z-2000 flex items-center p-4 left-0 top-0 h-full w-fit"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg max-w-md h-full overflow-y-auto"
        >
          <div
            class="flex items-center justify-between p-4 border-b border-slate-600"
          >
            <div class="flex items-center gap-2">
              <img
                src=${settingsIcon}
                alt="graphicsSettings"
                width="24"
                height="24"
                class="align-middle"
              />
              <h2 class="text-xl font-semibold text-white">
                ${translateText("graphics_setting.title")}
              </h2>
            </div>
            <button
              class="text-slate-400 hover:text-white text-2xl font-bold leading-none"
              @click=${this.closeModal}
            >
              ×
            </button>
          </div>

          <div class="p-4 flex flex-col gap-3">
            <div
              class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider"
            >
              ${translateText("graphics_setting.section_lighting")}
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.lighting_ambient_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.lighting_ambient_desc")}
                </div>
                <input
                  type="range"
                  min=${AMBIENT_LEVEL_MIN}
                  max=${AMBIENT_LEVEL_MAX}
                  step=${AMBIENT_LEVEL_STEP}
                  .value=${String(ambientLevel)}
                  @input=${this.onAmbientLevelChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${ambientLevel}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.lighting_unit_glow_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.lighting_unit_glow_desc")}
                </div>
                <input
                  type="range"
                  min=${UNIT_GLOW_MIN}
                  max=${UNIT_GLOW_MAX}
                  step=${UNIT_GLOW_STEP}
                  .value=${String(unitGlow)}
                  @input=${this.onUnitGlowChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${unitGlow}
              </div>
            </div>

            <div
              class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-2"
            >
              ${translateText("graphics_setting.section_name_labels")}
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.name_scale_label")}
                </div>
                <input
                  type="range"
                  min=${NAME_SCALE_MIN}
                  max=${NAME_SCALE_MAX}
                  step=${NAME_SCALE_STEP}
                  .value=${String(nameScale)}
                  @input=${this.onNameScaleChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${nameScale.toFixed(2)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.name_cull_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.name_cull_desc")}
                </div>
                <input
                  type="range"
                  min=${NAME_CULL_MIN}
                  max=${NAME_CULL_MAX}
                  step=${NAME_CULL_STEP}
                  .value=${String(nameCull)}
                  @input=${this.onNameCullChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${nameCull.toFixed(3)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.hover_fade_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.hover_fade_desc")}
                </div>
                <input
                  type="range"
                  min=${HOVER_FADE_MIN}
                  max=${HOVER_FADE_MAX}
                  step=${HOVER_FADE_STEP}
                  .value=${String(hoverFade)}
                  @input=${this.onHoverFadeChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${hoverFade.toFixed(2)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.hover_glow_width_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.hover_glow_width_desc")}
                </div>
                <input
                  type="range"
                  min=${HOVER_GLOW_WIDTH_MIN}
                  max=${HOVER_GLOW_WIDTH_MAX}
                  step=${HOVER_GLOW_WIDTH_STEP}
                  .value=${String(hoverGlowWidth)}
                  @input=${this.onHoverGlowWidthChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${hoverGlowWidth.toFixed(1)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.hover_glow_alpha_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.hover_glow_alpha_desc")}
                </div>
                <input
                  type="range"
                  min=${HOVER_GLOW_ALPHA_MIN}
                  max=${HOVER_GLOW_ALPHA_MAX}
                  step=${HOVER_GLOW_ALPHA_STEP}
                  .value=${String(hoverGlowAlpha)}
                  @input=${this.onHoverGlowAlphaChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${hoverGlowAlpha.toFixed(2)}
              </div>
            </div>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click=${this.onToggleNamesColored}
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.colored_names_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.colored_names_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${namesColored
                  ? translateText("graphics_setting.colored")
                  : translateText("graphics_setting.black")}
              </div>
            </button>

            <div
              class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-2"
            >
              ${translateText("graphics_setting.section_structure_icons")}
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.icon_size_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.icon_size_desc")}
                </div>
                <input
                  type="range"
                  min=${ICON_SIZE_MIN}
                  max=${ICON_SIZE_MAX}
                  step=${ICON_SIZE_STEP}
                  .value=${String(iconSize)}
                  @input=${this.onIconSizeChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${iconSize.toFixed(0)}
              </div>
            </div>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click=${this.onToggleClassicIcons}
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.classic_icons_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.classic_icons_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${classicIcons
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click=${this.onToggleClassicNumbers}
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.classic_numbers_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.classic_numbers_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${classicNumbers
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <div
              class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-2"
            >
              ${translateText("graphics_setting.section_map")}
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.highlight_fill_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.highlight_fill_desc")}
                </div>
                <input
                  type="range"
                  min=${HIGHLIGHT_FILL_MIN}
                  max=${HIGHLIGHT_FILL_MAX}
                  step=${HIGHLIGHT_FILL_STEP}
                  .value=${String(highlightFill)}
                  @input=${this.onHighlightFillChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${highlightFill.toFixed(2)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.highlight_brighten_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.highlight_brighten_desc")}
                </div>
                <input
                  type="range"
                  min=${HIGHLIGHT_BRIGHTEN_MIN}
                  max=${HIGHLIGHT_BRIGHTEN_MAX}
                  step=${HIGHLIGHT_BRIGHTEN_STEP}
                  .value=${String(highlightBrighten)}
                  @input=${this.onHighlightBrightenChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${highlightBrighten.toFixed(2)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.highlight_thicken_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.highlight_thicken_desc")}
                </div>
                <input
                  type="range"
                  min=${HIGHLIGHT_THICKEN_MIN}
                  max=${HIGHLIGHT_THICKEN_MAX}
                  step=${HIGHLIGHT_THICKEN_STEP}
                  .value=${String(highlightThicken)}
                  @input=${this.onHighlightThickenChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${highlightThicken.toFixed(0)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.territory_sat_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.territory_sat_desc")}
                </div>
                <input
                  type="range"
                  min=${TERRITORY_SAT_MIN}
                  max=${TERRITORY_SAT_MAX}
                  step=${TERRITORY_SAT_STEP}
                  .value=${String(territorySat)}
                  @input=${this.onTerritorySatChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${territorySat.toFixed(2)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.territory_alpha_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.territory_alpha_desc")}
                </div>
                <input
                  type="range"
                  min=${TERRITORY_ALPHA_MIN}
                  max=${TERRITORY_ALPHA_MAX}
                  step=${TERRITORY_ALPHA_STEP}
                  .value=${String(territoryAlpha)}
                  @input=${this.onTerritoryAlphaChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${territoryAlpha.toFixed(2)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText(
                    "graphics_setting.coordinate_grid_opacity_label",
                  )}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText(
                    "graphics_setting.coordinate_grid_opacity_desc",
                  )}
                </div>
                <input
                  type="range"
                  min=${COORDINATE_GRID_OPACITY_MIN}
                  max=${COORDINATE_GRID_OPACITY_MAX}
                  step=${COORDINATE_GRID_OPACITY_STEP}
                  .value=${String(coordinateGridOpacity)}
                  @input=${this.onCoordinateGridOpacityChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${coordinateGridOpacity.toFixed(2)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.rail_distance_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.rail_distance_desc")}
                </div>
                <input
                  type="range"
                  min=${RAIL_ZOOM_MIN}
                  max=${RAIL_ZOOM_MAX}
                  step=${RAIL_ZOOM_STEP}
                  .value=${String(railDrawDistance)}
                  @input=${this.onRailDrawDistanceChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${railDrawDistance.toFixed(1)}
              </div>
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.rail_thickness_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.rail_thickness_desc")}
                </div>
                <input
                  type="range"
                  min=${RAIL_THICKNESS_MIN}
                  max=${RAIL_THICKNESS_MAX}
                  step=${RAIL_THICKNESS_STEP}
                  .value=${String(railThickness)}
                  @input=${this.onRailThicknessChange}
                  class="w-full border border-slate-500 rounded-lg"
                />
              </div>
              <div class="text-sm text-slate-400 w-12 text-right">
                ${railThickness.toFixed(1)}
              </div>
            </div>

            <div
              class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-2"
            >
              ${translateText("graphics_setting.section_terrain")}
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.ocean_color_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.ocean_color_desc")}
                </div>
              </div>
              <input
                type="text"
                .value=${oceanColor}
                placeholder=${renderDefaults.terrain.oceanColor}
                spellcheck="false"
                @change=${this.onOceanColorChange}
                class="w-24 px-2 py-1 bg-slate-900 border border-slate-500 rounded-sm text-sm text-white font-mono"
              />
              <input
                type="color"
                .value=${oceanColor}
                @input=${this.onOceanColorChange}
                class="w-10 h-8 bg-transparent border border-slate-500 rounded-sm cursor-pointer"
              />
            </div>

            <div
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.nuke_color_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.nuke_color_desc")}
                </div>
              </div>
              <input
                type="text"
                .value=${nukeColor}
                placeholder=${NUKE_COLOR_DEFAULT}
                spellcheck="false"
                @change=${this.onNukeColorChange}
                class="w-24 px-2 py-1 bg-slate-900 border border-slate-500 rounded-sm text-sm text-white font-mono"
              />
              <input
                type="color"
                .value=${nukeColor}
                @input=${this.onNukeColorChange}
                class="w-10 h-8 bg-transparent border border-slate-500 rounded-sm cursor-pointer"
              />
            </div>

            <div
              class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-2"
            >
              ${translateText("graphics_setting.section_effects")}
            </div>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click=${this.onToggleSpecialEffects}
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.special_effects_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.special_effects_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.currentSpecialEffects()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click=${this.onToggleFallout}
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("graphics_setting.fallout_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("graphics_setting.fallout_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${this.currentFallout()
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <div
              class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-2"
            >
              ${translateText("graphics_setting.section_accessibility")}
            </div>

            <button
              class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
              @click=${this.onToggleColorblind}
            >
              <div class="flex-1">
                <div class="font-medium">
                  ${translateText("user_setting.colorblind_label")}
                </div>
                <div class="text-sm text-slate-400">
                  ${translateText("user_setting.colorblind_desc")}
                </div>
              </div>
              <div class="text-sm text-slate-400">
                ${colorblind
                  ? translateText("user_setting.on")
                  : translateText("user_setting.off")}
              </div>
            </button>

            <div class="border-t border-slate-600 pt-3 mt-4">
              <button
                class="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
                @click=${this.onResetClick}
              >
                <div class="flex-1">
                  <div class="font-medium">
                    ${translateText("graphics_setting.reset_label")}
                  </div>
                  <div class="text-sm text-slate-400">
                    ${translateText("graphics_setting.reset_desc")}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
