import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-toggle")
export class SettingToggle extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property() id = "";
  @property({ reflect: true, type: Boolean }) checked = false;
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.checked = input.checked;
    this.dispatchEvent(
      new CustomEvent("change", {
        bubbles: true,
        composed: true,
        detail: { checked: this.checked },
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
              ?checked=${this.checked}
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
