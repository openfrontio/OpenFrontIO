import type { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
import { BaseModal } from "./BaseModal";
import "./GraphicsAdvancedSettings";
import "./GraphicsPresetSelector";
import "./GraphicsPresetTools";
import { modalHeader } from "./ui/ModalHeader";

/** Reuses the shared controls and storage while leaving the map visible. */
@customElement("graphics-settings-modal")
export class GraphicsSettingsModal extends BaseModal {
  @property({ attribute: false }) mapLayers: MapLayer[] = [];
  private onReturn?: () => void;

  protected modalConfig() {
    return { sidePanel: true };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("user_setting.tab_graphics"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      showDivider: true,
    });
  }

  protected renderBody() {
    if (!this.isOpen()) return html``;
    return html`
      <div class="graphics-settings-panel flex flex-col gap-3 p-4">
        <graphics-advanced-settings
          class="flex flex-col gap-2"
          .mapLayers=${this.mapLayers}
        ></graphics-advanced-settings>
        <div class="text-white font-bold">
          ${translateText("user_setting.graphics_preset_label")}
        </div>
        <graphics-preset-selector></graphics-preset-selector>
        <graphics-preset-tools></graphics-preset-tools>
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>) {
    this.onReturn =
      typeof args?.onReturn === "function"
        ? (args.onReturn as () => void)
        : undefined;
  }

  protected onClose(args?: Record<string, unknown>) {
    const onReturn = this.onReturn;
    this.onReturn = undefined;
    if (!args?.silent) onReturn?.();
  }
}
