import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { translateText } from "../Utils";

@customElement("fluent-slider")
export class FluentSlider extends LitElement {
  createRenderRoot() {
    return this;
  }

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

  private handleNumberInput(e: Event) {
    const target = e.target as HTMLInputElement;
    let val = target.valueAsNumber;
    if (isNaN(val)) {
      val = this.min;
    }
    if (val < this.min) val = this.min;
    if (val > this.max) val = this.max;
    this.value = val;
    // Don't dispatch value change on every input - only on blur/enter
  }

  private handleNumberComplete() {
    // Dispatch the value change when editing is complete
    this.dispatchValueChange();
  }

  private handleNumberKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      this.isEditing = false;
      this.handleNumberComplete();
    }
  }

  private enableEditing() {
    this.isEditing = true;
    this.updateComplete.then(() => this.numberInput?.focus());
  }

  render() {
    const percentage = ((this.value - this.min) / (this.max - this.min)) * 100;
    return html`
      <div
        class="flex flex-col items-center justify-center gap-1 w-full text-center"
      >
        <input
          type="range"
          .min=${this.min}
          .max=${this.max}
          .step=${this.step}
          .valueAsNumber=${this.value}
          style="background: linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, rgba(255, 255, 255, 0.15) ${percentage}%, rgba(255, 255, 255, 0.15) 100%); background-size: 100% 6px; background-repeat: no-repeat; background-position: center; border-radius: 9999px;"
          class="w-full h-6 p-0 m-0 bg-transparent appearance-none cursor-pointer focus:outline-none 
                 [&::-webkit-slider-runnable-track]:w-full [&::-webkit-slider-runnable-track]:h-[6px] [&::-webkit-slider-runnable-track]:cursor-pointer [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:transition-colors
                 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-[18px] [&::-webkit-slider-thumb]:w-[18px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-mt-[6px] [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(59,130,246,0.2)] [&::-webkit-slider-thumb]:transition-all active:[&::-webkit-slider-thumb]:scale-110 active:[&::-webkit-slider-thumb]:shadow-[0_0_0_6px_rgba(59,130,246,0.3)]
                 [&::-moz-range-track]:w-full [&::-moz-range-track]:h-[6px] [&::-moz-range-track]:cursor-pointer [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:rounded-full [&::-moz-range-track]:transition-colors
                 [&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-[0_0_0_4px_rgba(59,130,246,0.2)] [&::-moz-range-thumb]:transition-all active:[&::-moz-range-thumb]:scale-110 active:[&::-moz-range-thumb]:shadow-[0_0_0_6px_rgba(59,130,246,0.3)]"
          @input=${this.handleSliderInput}
          @change=${this.handleSliderChange}
        />
        <div
          class="text-xs text-gray-400 text-center font-normal mb-1 w-full flex flex-col items-center"
        >
          <span>${this.labelKey ? translateText(this.labelKey) : ""}</span>
          ${this.isEditing
            ? html`<input
                type="number"
                .min=${this.min}
                .max=${this.max}
                .valueAsNumber=${this.value}
                class="w-[60px] bg-gray-800 text-gray-400 border border-gray-600 text-center rounded text-sm p-1 leading-none font-normal font-inherit mt-1"
                @input=${this.handleNumberInput}
                @blur=${() => {
                  this.isEditing = false;
                  this.handleNumberComplete();
                }}
                @keydown=${this.handleNumberKeyDown}
              />`
            : html`<span
                class="cursor-pointer min-w-[60px] inline-block text-center text-gray-400 text-sm font-normal select-none hover:text-white transition-colors mt-1"
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
