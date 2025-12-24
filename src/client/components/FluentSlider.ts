import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { translateText } from "../Utils";

@customElement("fluent-slider")
export class FluentSlider extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      font-family: inherit;
    }
    .slider-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: 100%;
      text-align: center;
    }
    .option-card-title {
      font-size: 14px; /* match other cards */
      color: #aaa; /* light gray text */
      text-align: center;
      margin: 0 0 4px 0;
      font-weight: normal;
    }
    input[type="range"] {
      width: 100%;
      max-width: 100%;
      background-color: transparent;
    }
    input[type="number"] {
      width: 60px;
      background-color: #2d3748;
      color: #aaa; /* match label color */
      border: 1px solid #4a5568;
      text-align: center;
      border-radius: 4px;
      font-weight: normal;
      font-family: inherit;
    }
    span.editable {
      cursor: pointer;
      min-width: 60px;
      display: inline-block;
      text-align: center;
      color: #aaa; /* match label color */
      font-weight: normal;
      user-select: none;
    }
  `;

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 400;
  @property({ type: Number }) step = 1;
  @property({ type: String }) labelKey = "";
  @property({ type: String }) disabledKey = "";

  @state() private isEditing = false;

  @query("input[type='number']") private numberInput!: HTMLInputElement;

  private dispatchValueChange() {
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleSliderInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.value = target.valueAsNumber;
  }

  private handleSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.value = target.valueAsNumber;
    this.dispatchValueChange();
  }

  private handleNumberChange(e: Event) {
    const target = e.target as HTMLInputElement;
    let val = target.valueAsNumber;
    if (isNaN(val)) {
      val = this.min;
    }
    if (val < this.min) val = this.min;
    if (val > this.max) val = this.max;
    this.value = val;
    this.dispatchValueChange();
  }

  private handleNumberKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") this.isEditing = false;
  }

  private enableEditing() {
    this.isEditing = true;
    this.updateComplete.then(() => this.numberInput?.focus());
  }

  render() {
    return html`
      <div class="slider-container">
        <input
          type="range"
          .min=${this.min}
          .max=${this.max}
          .step=${this.step}
          .valueAsNumber=${this.value}
          @input=${this.handleSliderInput}
          @change=${this.handleSliderChange}
        />
        <div class="option-card-title">
          <span>${this.labelKey ? translateText(this.labelKey) : ""}</span>
          ${this.isEditing
            ? html`<input
                type="number"
                .min=${this.min}
                .max=${this.max}
                .valueAsNumber=${this.value}
                @input=${this.handleNumberChange}
                @blur=${() => (this.isEditing = false)}
                @keydown=${this.handleNumberKeyDown}
              />`
            : html`<span
                class="editable"
                role="button"
                tabindex="0"
                @click=${this.enableEditing}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    this.enableEditing();
                    e.preventDefault();
                  }
                }}
              >
                ${this.value === 0 && this.disabledKey
                  ? translateText(this.disabledKey)
                  : this.value}
              </span>`}
        </div>
      </div>
    `;
  }
}
