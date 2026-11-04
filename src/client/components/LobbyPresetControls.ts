import { html, LitElement, PropertyValues } from "lit";
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
  @state() private expanded = false;

  createRenderRoot() {
    return this;
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("selectedName") && !this.selectedName) {
      this.nameInput = "";
    }
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
    const name = this.nameInput.trim().slice(0, MAX_PRESET_NAME_LENGTH);
    if (!name || this.disabled) return;
    this.dispatchEvent(
      new CustomEvent<string>("preset-save", {
        detail: name,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const expanded = this.expanded;

    return html`
      <div class="w-full mb-8 ${this.disabled ? "opacity-60" : ""}">
        <button
          type="button"
          aria-expanded=${expanded}
          data-test-preset-toggle
          @click=${() => (this.expanded = !this.expanded)}
          class="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-bold text-white uppercase tracking-wider transition-all duration-200 active:scale-[0.99] ${
            expanded
              ? "bg-malibu-blue/20 border-malibu-blue/50"
              : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
          }"
        >
          <svg
            class="w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 2l5 4-5 4z" />
          </svg>
          ${translateText("lobby_config.preset.title")}
        </button>

        ${expanded ? this.renderControls() : null}
      </div>
    `;
  }

  private renderControls() {
    const hasPresets = this.presets.length > 0;
    const canLoadOrDelete = !this.disabled && Boolean(this.selectedName);
    const canSave = !this.disabled && Boolean(this.nameInput.trim());

    return html`
      <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                ${
                  hasPresets
                    ? translateText("lobby_config.preset.select")
                    : translateText("lobby_config.preset.no_presets")
                }
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
    `;
  }
}
