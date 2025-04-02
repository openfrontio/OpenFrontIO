import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-number")
export class SettingNumber extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Boolean }) easter = false;

  createRenderRoot() {
    return this;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const newValue = Number(input.value);
    this.value = newValue;

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: newValue },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="setting-item${this.easter ? " easter-egg" : ""}">
        <div class="setting-label-group">
          <label class="setting-label" for="setting-number-input"
            >${this.label}</label
          >
          <div class="setting-description">${this.description}</div>
        </div>
        <input
          type="number"
          id="setting-number-input"
          class="setting-input number"
          .value=${String(this.value ?? 0)}
          min=${this.min}
          max=${this.max}
          @input=${this.handleInput}
        />
      </div>
    `;
  }
}
