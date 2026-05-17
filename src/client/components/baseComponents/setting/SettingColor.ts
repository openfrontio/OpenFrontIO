import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-color")
export class SettingColor extends LitElement {
  @property() label = "Color";
  @property() description = "";
  @property() value = "#000000";

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.value = input.value;
    
    // Dispatch an event so the parent component can listen to it
    this.dispatchEvent(new CustomEvent("change", {
      detail: { value: this.value },
      bubbles: true,
      composed: true
    }));
  }

  render() {
    return html`
      <label
        class="flex flex-row items-center justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-4 cursor-pointer"
      >
        <div class="flex flex-col flex-1 min-w-0 mr-4">
          <div class="text-white font-bold text-base block mb-1">
            ${this.label}
          </div>
          <div class="text-white/50 text-sm leading-snug">
            ${this.description}
          </div>
        </div>

        <div class="relative shrink-0 flex items-center gap-2">
          <div class="text-xs font-mono text-white/50">${this.value}</div>
          <input
            type="color"
            class="h-8 w-8 cursor-pointer rounded-md bg-transparent border-0 p-0"
            .value=${this.value}
            @input=${this.handleChange}
            @change=${this.handleChange}
          />
        </div>
      </label>
    `;
  }
}
