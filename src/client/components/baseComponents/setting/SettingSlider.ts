import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-slider")
export class SettingSlider extends LitElement {
  @property() label = "Setting";
  @property() description = "";
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: String, reflect: true }) icon = "";

  createRenderRoot() {
    return this;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.value = Number(input.value);
    this.updateSliderStyle(input);

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleSliderChange(e: Event) {
    const detail = (e as CustomEvent)?.detail;
    if (!detail || detail.value === undefined) {
      console.warn("Invalid slider change event", e);
      return;
    }

    const value = detail.value;
    console.log("Slider changed to", value);
  }

  private updateSliderStyle(slider: HTMLInputElement) {
    const percent = ((this.value - this.min) / (this.max - this.min)) * 100;
    slider.style.background = `linear-gradient(to right, #2196f3 ${percent}%, #444 ${percent}%)`;
  }

  firstUpdated() {
    const slider = this.renderRoot.querySelector(
      "input[type=range]",
    ) as HTMLInputElement;
    if (slider) this.updateSliderStyle(slider);
  }

  render() {
    return html`
      <div class="background-panel p-4 w-full max-w-full mb-4">
        <div class="flex items-center gap-3 mb-3">
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
        <input
          type="range"
          id="setting-slider-input"
          class="w-full h-2 rounded-none appearance-none cursor-pointer"
          min=${this.min}
          max=${this.max}
          .value=${String(this.value)}
          @input=${this.handleInput}
        />
        <div class="text-center mt-2 font-title text-textGrey">
          ${this.value}%
        </div>
      </div>
    `;
  }
}
