import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-toggle")
export class SettingToggle extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: String, reflect: true }) icon = "";

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    // Toggle the checked state since we're clicking a button, not an input
    this.checked = !this.checked;

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { checked: this.checked },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="background-panel p-4 mb-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            ${this.icon
              ? html`<o-icon
                  src="${this.icon}"
                  size="large"
                  color="var(--text-color-grey)"
                  class="mr-2"
                ></o-icon>`
              : ""}
            <div>
              <div class="font-title text-textLight">${this.label}</div>
              <div class="text-small text-textGrey">${this.description}</div>
            </div>
          </div>
          <button
            class="w-14 h-7 flex items-center rounded-full ${this.checked
              ? "bg-primary"
              : "bg-backgroundGrey"} relative transition-colors duration-200 flex-shrink-0"
            @click=${this.handleChange}
          >
            <div
              class="w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform duration-200 ${this
                .checked
                ? "translate-x-7"
                : "translate-x-1"}"
            ></div>
          </button>
        </div>
      </div>
    `;
  }
}
