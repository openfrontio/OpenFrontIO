import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
@customElement("checkbox-with-input")
export class CheckboxWithInput extends LitElement {
  @property({ type: String }) labelKey: string = "";
  @property({ type: Boolean }) checked: boolean = false;

  // Current numeric value (when checked)
  @property({ type: Number }) value: number | null | undefined = null;
  // Default value when checkbox is first checked
  @property({ type: Number }) defaultValue: number = 0;
  @property({ type: Number }) min: number = 0;
  @property({ type: Number }) max: number = 100;
  @property({ type: String }) inputId: string = "";

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <label
        for=${this.inputId}
        class="option-card ${this.checked ? "selected" : ""}"
      >
        <div class="checkbox-icon"></div>
        <input
          type="checkbox"
          id=${this.inputId}
          @change=${this.handleCheckboxChange}
          .checked=${this.checked}
        />
        ${this.checked
          ? html`<input
              type="number"
              id="${this.inputId}-value"
              min="${this.min}"
              max="${this.max}"
              .value=${String(this.value ?? "")}
              style="width: 60px; color: black; text-align: right; border-radius: 8px;"
              @input=${this.handleInputChange}
              @keydown=${this.handleKeyDown}
            />`
          : ""}
        <div class="option-card-title">${translateText(this.labelKey)}</div>
      </label>
    `;
  }

  private handleCheckboxChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;

    this.dispatchEvent(
      new CustomEvent("checkbox-change", {
        detail: {
          checked,
          defaultValue: this.defaultValue,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleKeyDown(e: KeyboardEvent) {
    // Prevent invalid characters in number input
    if (["-", "+", "e"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private handleInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    // Remove invalid characters
    input.value = input.value.replace(/[e+-]/gi, "");

    let value = parseInt(input.value);

    // If not a number, ignore
    if (isNaN(value)) {
      return;
    }

    // Clamp value to min/max range
    value = Math.max(this.min, Math.min(this.max, value));

    // Update the input to show the clamped value
    input.value = String(value);

    this.dispatchEvent(
      new CustomEvent("value-change", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
