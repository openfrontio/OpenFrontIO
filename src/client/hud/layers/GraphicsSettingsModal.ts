import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { z } from "zod";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import renderDefaults from "../../render/gl/render-settings.json";

const settingsIcon = assetUrl("images/SettingIconWhite.svg");

export const GraphicsOverridesSchema = z
  .object({
    name: z
      .object({
        nameScaleFactor: z.number(),
        cullThreshold: z.number(),
      })
      .partial(),
  })
  .partial();

export type GraphicsOverrides = z.infer<typeof GraphicsOverridesSchema>;

const NAME_SCALE_MIN = 0.2;
const NAME_SCALE_MAX = 1.5;
const NAME_SCALE_STEP = 0.05;

const NAME_CULL_MIN = 0;
const NAME_CULL_MAX = 0.05;
const NAME_CULL_STEP = 0.001;

export class ShowGraphicsSettingsModalEvent {
  constructor(public readonly isVisible: boolean = true) {}
}

@customElement("graphics-settings-modal")
export class GraphicsSettingsModal extends LitElement implements Controller {
  public eventBus: EventBus;
  public userSettings: UserSettings;

  @state()
  private isVisible: boolean = false;

  @query(".modal-overlay")
  private modalOverlay!: HTMLElement;

  init() {
    this.eventBus.on(ShowGraphicsSettingsModalEvent, (event) => {
      this.isVisible = event.isVisible;
      this.requestUpdate();
    });
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

  private onNameScaleChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ nameScaleFactor: value });
  }

  private onNameCullChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.patchName({ cullThreshold: value });
  }

  private onResetClick() {
    this.userSettings.setGraphicsOverrides({});
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) return null;

    const nameScale = this.currentNameScale();
    const nameCull = this.currentNameCull();

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
