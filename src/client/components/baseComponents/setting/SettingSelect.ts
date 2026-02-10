import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

export type SettingSelectOption = { value: string; label: string };

@customElement("setting-select")
export class SettingSelect extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property() value = "";
  @property({ attribute: false }) options: SettingSelectOption[] = [];
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.value = select.value;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const rainbowClass = this.easter
      ? "bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)] bg-[length:1400%_1400%] animate-rainbow-bg text-white hover:bg-[linear-gradient(270deg,#990033,#996600,#336600,#008080,#1c3f99,#5e0099,#990033)]"
      : "";

    return html`
      <div
        class="flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4 ${rainbowClass}"
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <div class="text-white font-bold text-base block mb-1">
            ${this.label}
          </div>
          <div class="text-white/50 text-sm leading-snug">
            ${this.description}
          </div>
        </div>

        <select
          id=${this.id}
          class="shrink-0 bg-black/60 border border-white/10 text-white/90 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
          .value=${this.value}
          @change=${this.handleChange}
        >
          ${this.options.map(
            (o) => html`<option value=${o.value}>${o.label}</option>`,
          )}
        </select>
      </div>
    `;
  }
}
