import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";

@customElement("inline-slider")
export class InlineSlider extends LitElement {
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) step = 1;
  @property({ type: Boolean }) compact = false;
  @property({ type: String, attribute: "aria-label" }) ariaLabel = "Slider";
  @property({ type: String, attribute: "aria-value-text" }) ariaValueText = "";

  private draggingPointerId: number | null = null;

  createRenderRoot() {
    return this;
  }

  private get clampedValue() {
    if (this.max <= this.min) return this.min;
    return Math.min(this.max, Math.max(this.min, this.value));
  }

  private get fillPercent() {
    if (this.max <= this.min) return 0;
    return ((this.clampedValue - this.min) / (this.max - this.min)) * 100;
  }

  private get stepPrecision() {
    const stepString = String(this.step);
    if (stepString.includes("e-")) {
      return Number(stepString.split("e-")[1] ?? 0);
    }
    return stepString.split(".")[1]?.length ?? 0;
  }

  private normalizeValue(rawValue: number) {
    if (!Number.isFinite(rawValue)) {
      return this.clampedValue;
    }

    const clamped = Math.min(this.max, Math.max(this.min, rawValue));
    if (this.step <= 0) return clamped;

    const steps = Math.round((clamped - this.min) / this.step);
    const snapped = this.min + steps * this.step;
    return Number(
      Math.min(this.max, Math.max(this.min, snapped)).toFixed(
        this.stepPrecision,
      ),
    );
  }

  private emitValueChange(value: number) {
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private setValue(nextValue: number) {
    const normalized = this.normalizeValue(nextValue);
    if (normalized === this.value) return;
    this.value = normalized;
    this.emitValueChange(normalized);
  }

  private updateValueFromPointer(e: PointerEvent, sliderTrack: HTMLElement) {
    const rect = sliderTrack.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = (e.clientX - rect.left) / rect.width;
    const nextValue = this.min + ratio * (this.max - this.min);
    this.setValue(nextValue);
  }

  private handlePointerDown = (e: PointerEvent) => {
    const sliderTrack = e.currentTarget as HTMLElement;
    if (e.button !== 0 && e.pointerType === "mouse") return;

    this.draggingPointerId = e.pointerId;
    sliderTrack.setPointerCapture(e.pointerId);
    this.updateValueFromPointer(e, sliderTrack);
    e.preventDefault();
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (this.draggingPointerId !== e.pointerId) return;

    const sliderTrack = e.currentTarget as HTMLElement;
    this.updateValueFromPointer(e, sliderTrack);
    e.preventDefault();
  };

  private handlePointerUp = (e: PointerEvent) => {
    if (this.draggingPointerId !== e.pointerId) return;

    this.draggingPointerId = null;
    const sliderTrack = e.currentTarget as HTMLElement;
    if (sliderTrack.hasPointerCapture(e.pointerId)) {
      sliderTrack.releasePointerCapture(e.pointerId);
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const step = this.step > 0 ? this.step : (this.max - this.min) / 100 || 1;
    let nextValue: number | null = null;

    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextValue = this.clampedValue - step;
        break;
      case "ArrowRight":
      case "ArrowUp":
        nextValue = this.clampedValue + step;
        break;
      case "PageDown":
        nextValue = this.clampedValue - step * 10;
        break;
      case "PageUp":
        nextValue = this.clampedValue + step * 10;
        break;
      case "Home":
        nextValue = this.min;
        break;
      case "End":
        nextValue = this.max;
        break;
      default:
        return;
    }

    this.setValue(nextValue);
    e.preventDefault();
  };

  render() {
    const heightClass = this.compact ? "h-1.5" : "h-2";
    const thumbClass = this.compact ? "w-3 h-3" : "w-3.5 h-3.5";

    return html`
      <div class="w-full min-w-0">
        <div
          class="relative w-full ${heightClass} rounded-full bg-slate-700/70 border border-slate-300/25 shadow-inner cursor-pointer touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          role="slider"
          tabindex="0"
          aria-label=${this.ariaLabel}
          aria-valuemin=${this.min}
          aria-valuemax=${this.max}
          aria-valuenow=${this.clampedValue}
          aria-valuetext=${ifDefined(this.ariaValueText || undefined)}
          @pointerdown=${this.handlePointerDown}
          @pointermove=${this.handlePointerMove}
          @pointerup=${this.handlePointerUp}
          @pointercancel=${this.handlePointerUp}
          @keydown=${this.handleKeyDown}
        >
          <div
            class="absolute left-0 top-0 h-full rounded-full bg-blue-500"
            style="width: ${this.fillPercent}%;"
          ></div>
          <div
            class="absolute top-1/2 ${thumbClass} rounded-full bg-white border border-slate-300 -translate-x-1/2 -translate-y-1/2"
            style="left: ${this
              .fillPercent}%; box-shadow: 0 0 0 1px rgba(15,23,42,0.35), 0 1px 2px rgba(0,0,0,0.45);"
          ></div>
        </div>
      </div>
    `;
  }
}
