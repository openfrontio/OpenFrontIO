import type { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { UserSettings } from "../UserSettings";
import { translateText } from "../Utils";
import { BaseModal } from "./BaseModal";
import "./GraphicsAdvancedSettings";
import "./GraphicsPresetSelector";
import "./GraphicsPresetTools";
import { hudOpacitySetting } from "./ui/HudOpacitySetting";

/** Reuses the shared controls and storage while leaving the map visible. */
@customElement("graphics-settings-modal")
export class GraphicsSettingsModal extends BaseModal {
  @property({ attribute: false }) mapLayers: MapLayer[] = [];
  private onReturn?: () => void;
  private readonly userSettings = new UserSettings();

  protected modalConfig() {
    return { sidePanel: true };
  }

  protected renderHeaderSlot() {
    return html`
      <div
        class="flex items-center justify-between gap-3 p-3 border-b border-slate-600"
      >
        <h2 class="text-base font-semibold text-white">
          ${translateText("user_setting.tab_graphics")}
        </h2>
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 rounded-sm text-slate-400 hover:text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-blue-400"
          aria-label=${translateText("common.close")}
          @click=${() => this.close()}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      </div>
    `;
  }

  /** Unmount live controls on close so their settings listeners are released. */
  protected renderBody() {
    if (!this.isOpen()) return html``;
    return html`
      <div class="graphics-settings-panel flex flex-col px-4 pb-4">
        ${hudOpacitySetting(this.userSettings)}
        <graphics-advanced-settings
          class="flex flex-col"
          .mapLayers=${this.mapLayers}
        ></graphics-advanced-settings>
        <div
          class="text-slate-400 text-xs font-semibold uppercase tracking-wider pt-4 pb-2"
        >
          ${translateText("user_setting.graphics_preset_label")}
        </div>
        <graphics-preset-selector></graphics-preset-selector>
        <graphics-preset-tools></graphics-preset-tools>
      </div>
    `;
  }

  /** Capture the caller's return path for this opening only. */
  protected onOpen(args?: Record<string, unknown>) {
    this.onReturn =
      typeof args?.onReturn === "function"
        ? (args.onReturn as () => void)
        : undefined;
  }

  /** Navigation can dismiss silently instead of reopening the previous menu. */
  protected onClose(args?: Record<string, unknown>) {
    const onReturn = this.onReturn;
    this.onReturn = undefined;
    if (!args?.silent) onReturn?.();
  }
}
