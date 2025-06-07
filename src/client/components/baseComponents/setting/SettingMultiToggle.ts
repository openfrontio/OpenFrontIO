import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-multi-toggle")
export class SettingMultiToggle extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ type: String, reflect: true }) value = "";
  @property({ type: Array<string> }) values = [];

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const index = this.values.findIndex((str) => str === this.value);
    let nextIndex = index + 1;
    if (nextIndex > this.values.length - 1) {
      nextIndex = 0;
    }

    this.value = this.values[nextIndex];
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
      <div class="setting-item vertical">
        <div class="toggle-row">
          <label class="setting-label" for=${this.id}>${this.label}</label>
          <button
            id=${this.id}
            class="multi-toggle"
            @click=${this.handleChange}
          >
            ${this.value}
          </button>
        </div>
        <div class="setting-description">${this.description}</div>
      </div>
    `;
  }
}
