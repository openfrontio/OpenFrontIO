import { html, LitElement, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LobbyPreset, MAX_PRESET_NAME_LENGTH } from "../LobbyPresets";
import { translateText } from "../Utils";
import "./baseComponents/Button";

// The popover's width (24rem) in CSS pixels, and the gap it keeps from the
// modal's edges.
const POPOVER_WIDTH_PX = 384;
const EDGE_PX = 16;

@customElement("lobby-preset-controls")
export class LobbyPresetControls extends LitElement {
  @property({ type: Array }) presets: LobbyPreset[] = [];
  @property({ type: String }) selectedName = "";
  @property({ type: Boolean }) disabled = false;

  @state() private nameInput = "";
  @state() private open = false;
  // Where the popover sits, relative to the button, and how wide it is.
  @state() private popoverLeft = 0;
  @state() private popoverWidth = POPOVER_WIDTH_PX;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback(): void {
    this.setOpen(false);
    super.disconnectedCallback();
  }

  private setOpen(open: boolean) {
    if (open) this.place();
    this.open = open;
    if (open) {
      document.addEventListener("pointerdown", this.onOutside, true);
      // Capture on window runs before BaseModal's own Escape listener there,
      // wherever focus has moved since the popover opened.
      window.addEventListener("keydown", this.onKeyDown, true);
    } else {
      document.removeEventListener("pointerdown", this.onOutside, true);
      window.removeEventListener("keydown", this.onKeyDown, true);
    }
  }

  // Right-aligned under the button, shifted sideways to stay inside the modal
  // header, which spans the modal's width. Wherever the header puts the
  // button, including on its own row once a narrow header wraps.
  private place() {
    const header = this.closest('[slot="header"]')?.getBoundingClientRect();
    const boundLeft = header?.left ?? 0;
    const boundRight = header?.right ?? window.innerWidth;
    const trigger = this.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(POPOVER_WIDTH_PX, boundRight - boundLeft - 2 * EDGE_PX),
    );
    const left = Math.max(
      boundLeft + EDGE_PX,
      Math.min(trigger.right - width, boundRight - EDGE_PX - width),
    );
    this.popoverLeft = left - trigger.left;
    this.popoverWidth = width;
  }

  // A press anywhere else closes the popover.
  private onOutside = (e: Event): void => {
    if (!this.contains(e.target as Node)) this.setOpen(false);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !this.open) return;
    // Only the popover closes: the modal holding it stays open.
    e.preventDefault();
    e.stopPropagation();
    this.setOpen(false);
  };

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
    this.setOpen(false);
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
    const open = this.open;

    return html`
      <div class="relative shrink-0">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded=${open}
          data-test-preset-toggle
          @click=${() => this.setOpen(!this.open)}
          class="flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
            open
              ? "bg-malibu-blue/20 border-malibu-blue/50 text-white"
              : "border-white/10 bg-white/5 hover:bg-white/10 text-white/60"
          }"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-4 h-4 shrink-0"
            aria-hidden="true"
          >
            <path
              d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625z"
            />
            <path
              d="M12.971 1.816A5.23 5.23 0 0114.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 013.434 1.279 9.768 9.768 0 00-6.963-6.963z"
            />
          </svg>
          <span
            class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
            >${translateText("lobby_config.preset.title")}</span
          >
        </button>

        ${
          open
            ? html`<div
                role="dialog"
                aria-label=${translateText("lobby_config.preset.title")}
                style="left: ${this.popoverLeft}px; width: ${this.popoverWidth}px"
                class="absolute top-[calc(100%+8px)] z-50 rounded-xl border border-white/15 bg-zinc-900 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.55)] ${
                  this.disabled ? "opacity-60" : ""
                }"
              >
                ${this.renderControls()}
              </div>`
            : null
        }
      </div>
    `;
  }

  private renderControls() {
    const hasPresets = this.presets.length > 0;
    const canLoadOrDelete = !this.disabled && Boolean(this.selectedName);
    const canSave = !this.disabled && Boolean(this.nameInput.trim());

    return html`
      <div class="flex flex-col gap-4">
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
