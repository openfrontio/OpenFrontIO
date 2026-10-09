import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LobbyPreset, MAX_PRESET_NAME_LENGTH } from "../LobbyPresets";
import { translateText } from "../Utils";
import "./baseComponents/Button";

@customElement("lobby-preset-controls")
export class LobbyPresetControls extends LitElement {
  @property({ type: Array }) presets: LobbyPreset[] = [];
  @property({ type: String }) selectedName = "";
  @property({ type: Boolean }) disabled = false;

  @state() private nameInput = "";

  createRenderRoot() {
    return this;
  }

  private handleSelectChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    const value = select.value;
    this.selectedName = value;
    if (value) {
      this.nameInput = value;
    }
    this.dispatchEvent(
      new CustomEvent<string>("preset-select", {
        detail: value,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleLoad() {
    const name = this.selectedName.trim();
    if (!name || this.disabled) return;
    this.dispatchEvent(
      new CustomEvent<string>("preset-load", {
        detail: name,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleDelete() {
    const name = this.selectedName.trim();
    if (!name || this.disabled) return;
    this.dispatchEvent(
      new CustomEvent<string>("preset-delete", {
        detail: name,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleNameInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.nameInput = input.value;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      this.handleSave();
    }
  }

  private handleSave() {
    const name = (this.nameInput.trim() || this.selectedName.trim()).slice(
      0,
      MAX_PRESET_NAME_LENGTH,
    );
    if (!name || this.disabled) return;
    this.dispatchEvent(
      new CustomEvent<string>("preset-save", {
        detail: name,
        bubbles: true,
        composed: true,
      }),
    );
    this.selectedName = name;
  }

  render() {
    const hasPresets = this.presets.length > 0;
    const canLoadOrDelete = !this.disabled && Boolean(this.selectedName);
    const canSave =
      !this.disabled &&
      Boolean(this.nameInput.trim() || this.selectedName.trim());

    return html`
      <div
        class="w-full bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-5 mb-8 ${this
          .disabled
          ? "opacity-60"
          : ""}"
      >
        <div class="flex items-center gap-3 pb-3 border-b border-white/10 mb-4">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center bg-malibu-blue/20 text-malibu-blue"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              class="w-5 h-5"
            >
              <path
                d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625z"
              />
              <path
                d="M12.971 1.816A5.23 5.23 0 0114.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 013.434 1.279 9.768 9.768 0 00-6.963-6.963z"
              />
            </svg>
          </div>
          <h3 class="text-base font-bold text-white uppercase tracking-wider">
            ${translateText("lobby_config.preset.title")}
          </h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Load / Delete Existing Preset -->
          <div class="flex flex-col gap-2">
            <label
              class="text-xs uppercase font-bold tracking-wider text-white/60"
            >
              ${translateText("lobby_config.preset.select_label")}
            </label>
            <div class="flex gap-2 items-center">
              <select
                data-test-preset-select
                class="flex-1 min-w-0 bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-white text-sm font-semibold focus:outline-none focus:border-malibu-blue disabled:opacity-50 transition-colors"
                .value=${this.selectedName}
                @change=${this.handleSelectChange}
                ?disabled=${this.disabled || !hasPresets}
              >
                <option value="">
                  ${hasPresets
                    ? translateText("lobby_config.preset.select")
                    : translateText("lobby_config.preset.no_presets")}
                </option>
                ${this.presets.map(
                  (p) => html`
                    <option
                      value=${p.name}
                      ?selected=${p.name === this.selectedName}
                    >
                      ${p.name}
                    </option>
                  `,
                )}
              </select>
              <o-button
                data-test-preset-load-btn
                title=${translateText("lobby_config.preset.load")}
                variant="primary"
                size="sm"
                ?disable=${!canLoadOrDelete}
                @click=${this.handleLoad}
              ></o-button>
              <o-button
                data-test-preset-delete-btn
                title=${translateText("lobby_config.preset.delete")}
                variant="danger"
                size="sm"
                ?disable=${!canLoadOrDelete}
                @click=${this.handleDelete}
              ></o-button>
            </div>
          </div>

          <!-- Save Current Configuration -->
          <div class="flex flex-col gap-2">
            <label
              class="text-xs uppercase font-bold tracking-wider text-white/60"
            >
              ${translateText("lobby_config.preset.save_label")}
            </label>
            <div class="flex gap-2 items-center">
              <input
                data-test-preset-name-input
                type="text"
                maxlength=${MAX_PRESET_NAME_LENGTH}
                placeholder=${translateText("lobby_config.preset.placeholder")}
                .value=${this.nameInput}
                @input=${this.handleNameInput}
                @keydown=${this.handleKeyDown}
                class="flex-1 min-w-0 bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-white text-sm font-semibold placeholder:text-white/40 focus:outline-none focus:border-malibu-blue disabled:opacity-50 transition-colors"
                ?disabled=${this.disabled}
              />
              <o-button
                data-test-preset-save-btn
                title=${translateText("lobby_config.preset.save")}
                variant="secondary"
                size="sm"
                ?disable=${!canSave}
                @click=${this.handleSave}
              ></o-button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
