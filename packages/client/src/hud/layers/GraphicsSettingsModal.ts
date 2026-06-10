import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { crazyGamesSDK } from "client/CrazyGamesSDK";
import { PauseGameIntentEvent } from "client/Transport";
import { assetUrl } from "engine/AssetUrls";
import { EventBus } from "engine/EventBus";
import { UserSettings } from "engine/game/UserSettings";
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

// Train track "draw distance" is presented inverted: a higher slider value means
// tracks stay visible when more zoomed out, i.e. a lower railMinZoom.
const RAIL_ZOOM_MIN = 0;
const RAIL_ZOOM_MAX = 10;
const RAIL_ZOOM_STEP = 0.1;

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

  private currentRailMinZoom(): number {
    return (
      this.userSettings.graphicsOverrides().railroad?.railMinZoom ??
      renderDefaults.railroad.railMinZoom
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

  private onRailDrawDistanceChange(event: Event) {
    const drawDistance = parseFloat((event.target as HTMLInputElement).value);
    // Invert: higher draw distance => tracks visible when more zoomed out.
    this.patchRailroad({ railMinZoom: RAIL_ZOOM_MAX - drawDistance });
  }

  private currentClassicIcons(): boolean {
    return (
      this.userSettings.graphicsOverrides().structure?.classicIcons ?? false
    );
  }

  private onToggleClassicIcons() {
    this.patchStructure({ classicIcons: !this.currentClassicIcons() });
  }

  private patchPassEnabled(patch: Partial<GraphicsOverrides["passEnabled"]>) {
    const current = this.userSettings.graphicsOverrides();
    this.userSettings.setGraphicsOverrides({
      ...current,
      passEnabled: { ...current.passEnabled, ...patch },
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

  private onNameScaleChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ nameScaleFactor: value });
  }

  private onNameCullChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ cullThreshold: value });
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
    const namesColored = !this.currentDarkNames();
    const classicIcons = this.currentClassicIcons();
    const highlightFill = this.currentHighlightFill();
    const highlightBrighten = this.currentHighlightBrighten();
    const highlightThicken = this.currentHighlightThicken();
    const territorySat = this.currentTerritorySat();
    const territoryAlpha = this.currentTerritoryAlpha();
    const railDrawDistance = RAIL_ZOOM_MAX - this.currentRailMinZoom();

    return html`
      <div
        class="modal-overlay fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="bg-slate-800 border border-slate-600 rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto"
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
