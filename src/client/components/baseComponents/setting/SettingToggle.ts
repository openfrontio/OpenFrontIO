import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-toggle")
export class SettingToggle extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ type: Boolean, reflect: true }) checked = false;
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { checked: input.checked },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="setting-item vertical${this.easter ? " easter-egg" : ""}">
        <div class="toggle-row">
          <label class="setting-label" for=${this.id}>${this.label}</label>
          <label class="switch">
            <input
              type="checkbox"
              id=${this.id}
              .checked=${this.checked}
              @change=${this.handleChange}
            />
            <span class="slider-round"></span>
          </label>
        </div>
        <div class="setting-description">${this.description}</div>
      </div>
    `;
  }
}
