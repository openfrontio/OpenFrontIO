import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../../core/game/UserSettings";
import {
  migrateLegacyGraphicsSettings,
  parseGraphicsOverridesJson,
} from "../GraphicsPresets";
import { translateText } from "../Utils";

/**
 * Save / copy / import for the whole graphics configuration.
 *
 * Sits at the top level of the Graphics tab, beside the preset dropdown rather
 * than inside the Advanced fold: saving what you just tuned is not itself a
 * tuning control, and a player who never expands Advanced should still find it.
 *
 * Self-contained like `graphics-preset-selector`: it reads and writes
 * `UserSettings` directly. A write to the graphics key is what a running game
 * follows, so an import applies live with no renderer reference here.
 */
@customElement("graphics-preset-tools")
export class GraphicsPresetTools extends LitElement {
  private readonly userSettings = new UserSettings();

  @state() private presetName = "";
  @state() private importText = "";
  @state() private importError = false;
  @state() private copiedJson = false;

  private copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Snapshot pre-preset custom settings before an import can overwrite them
    // wholesale. Idempotent, and a no-op once done.
    migrateLegacyGraphicsSettings(this.userSettings);
  }

  disconnectedCallback() {
    clearTimeout(this.copyResetTimer);
    super.disconnectedCallback();
  }

  private onPresetNameInput(event: Event) {
    this.presetName = (event.target as HTMLInputElement).value;
  }

  private onSavePreset() {
    const name = this.presetName.trim();
    if (!name) return;
    this.userSettings.setGraphicsPresets({
      ...this.userSettings.graphicsPresets(),
      [name]: this.userSettings.graphicsOverrides(),
    });
    this.presetName = "";
  }

  private async onCopyJson() {
    const json = JSON.stringify(this.userSettings.graphicsOverrides(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      return; // clipboard unavailable (permissions / insecure context)
    }
    this.copiedJson = true;
    clearTimeout(this.copyResetTimer);
    this.copyResetTimer = setTimeout(() => (this.copiedJson = false), 1500);
  }

  private onImportTextInput(event: Event) {
    this.importText = (event.target as HTMLTextAreaElement).value;
    this.importError = false;
  }

  private onImportApply() {
    // The text is whatever the player pasted, so the parse is guarded as well
    // as checked. Deeply nested input survives JSON.parse and the schema (which
    // strips what it does not know) only to overflow the stack in the
    // structural comparison behind it — a RangeError, not a parse failure.
    // Either way the answer to the player is the same: that is not settings
    // JSON.
    try {
      const parsed = parseGraphicsOverridesJson(this.importText);
      if (parsed === null) {
        this.importError = true;
        return;
      }
      this.userSettings.setGraphicsOverrides(parsed);
    } catch {
      this.importError = true;
      return;
    }
    this.importText = "";
  }

  render() {
    return html`
      <div
        class="flex flex-col w-full p-4 bg-white/5 border border-white/10 rounded-xl gap-3"
      >
        <div class="flex gap-3 items-center w-full">
          <input
            type="text"
            id="graphics-preset-name"
            aria-label=${translateText(
              "graphics_setting.preset_name_placeholder",
            )}
            .value=${this.presetName}
            placeholder=${translateText(
              "graphics_setting.preset_name_placeholder",
            )}
            spellcheck="false"
            maxlength="40"
            @input=${this.onPresetNameInput}
            class="flex-1 min-w-0 px-2 py-1.5 bg-black/40 border border-white/20 rounded-lg text-sm text-white"
          />
          <button
            id="graphics-save-preset"
            class="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white disabled:opacity-50"
            ?disabled=${this.presetName.trim() === ""}
            @click=${this.onSavePreset}
          >
            ${translateText("graphics_setting.save_preset_label")}
          </button>
        </div>
      </div>

      <button
        id="graphics-copy-json"
        class="flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4 text-left"
        @click=${this.onCopyJson}
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <div class="text-white font-bold text-base block mb-1">
            ${translateText("graphics_setting.copy_json_label")}
          </div>
          <div class="text-white/50 text-sm leading-snug">
            ${translateText("graphics_setting.copy_json_desc")}
          </div>
        </div>
        <div class="text-white/50 text-sm shrink-0">
          ${this.copiedJson ? translateText("common.copied") : ""}
        </div>
      </button>

      <div
        class="flex flex-col w-full p-4 bg-white/5 border border-white/10 rounded-xl gap-2"
      >
        <div class="text-white font-bold text-base">
          ${translateText("graphics_setting.import_json_label")}
        </div>
        <div class="text-white/50 text-sm leading-snug">
          ${translateText("graphics_setting.import_json_desc")}
        </div>
        <textarea
          id="graphics-import-json"
          aria-label=${translateText("graphics_setting.import_json_label")}
          rows="3"
          .value=${this.importText}
          spellcheck="false"
          @input=${this.onImportTextInput}
          class="w-full px-2 py-1.5 bg-black/40 border ${this.importError
            ? "border-red-500"
            : "border-white/20"} rounded-lg text-sm text-white font-mono"
        ></textarea>
        ${this.importError
          ? html`<div id="graphics-import-error" class="text-sm text-red-400">
              ${translateText("graphics_setting.import_json_invalid")}
            </div>`
          : nothing}
        <button
          id="graphics-import-apply"
          class="self-start px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white disabled:opacity-50"
          ?disabled=${this.importText.trim() === ""}
          @click=${this.onImportApply}
        >
          ${translateText("graphics_setting.import_json_apply")}
        </button>
      </div>
    `;
  }
}
