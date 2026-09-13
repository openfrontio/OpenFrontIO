import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * A labelled color swatch, shaped like the other setting-* rows.
 *
 * Emits `change` with the picked `#rrggbb` string. A native color input only
 * ever produces a complete six-digit hex, but the value is forwarded verbatim
 * and validated by the host — the same input is reachable by keyboard in some
 * browsers, where a partial value can surface mid-edit.
 */
@customElement("setting-color")
export class SettingColor extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() value = "#000000";

  createRenderRoot() {
    return this;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.value = input.value;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: input.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div
        class="flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4"
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <div class="text-white font-bold text-base block mb-1">
            ${this.label}
          </div>
          <div class="text-white/50 text-sm leading-snug">
            ${this.description}
          </div>
        </div>
        <input
          type="color"
          aria-label=${this.label}
          .value=${this.value}
          @input=${this.handleInput}
          class="w-12 h-9 shrink-0 bg-transparent border border-white/20 rounded-lg cursor-pointer"
        />
      </div>
    `;
  }
}
