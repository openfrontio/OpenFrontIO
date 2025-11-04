import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("setting-slider")
export class SettingSlider extends LitElement {
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
      <div class="setting-item vertical${this.easter ? " easter-egg" : ""}">
        <div class="setting-label-group">
          <label class="setting-label" for="setting-slider-input"
            >${this.label}</label
          >
          <div class="setting-description">${this.description}</div>
        </div>
        <input
          type="range"
          id="setting-slider-input"
          class="setting-input slider full-width"
          min=${this.min}
          max=${this.max}
          .value=${String(this.value)}
          @input=${this.handleInput}
        />
        <div class="slider-value">${this.value}%</div>
      </div>
    `;
  }
}
