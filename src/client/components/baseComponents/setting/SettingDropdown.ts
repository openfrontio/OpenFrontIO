import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-dropdown")
export class SettingDropdown extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ type: Array }) options: { value: string; label: string }[] = [];
  @property() value = "";

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

        <div class="relative inline-block w-auto shrink-0">
          <select
            id=${this.id}
            class="bg-black/40 text-white border border-white/20 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none pr-8"
            @change=${this.handleChange}
            .value=${this.value}
          >
            ${this.options.map(
              (option) => html`
                <option
                  value=${option.value}
                  class="bg-gray-900 text-white"
                  ?selected=${option.value === this.value}
                >
                  ${option.label}
                </option>
              `,
            )}
          </select>
          <div
            class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-white/50"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      </label>
    `;
  }
}
