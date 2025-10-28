import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("bots-slider")
export class BotsSlider extends LitElement {
  @property({ type: Number }) value = 0;
  @property({ type: Number }) max = 400;
  @property({ type: Number }) debounceMs = 0;

  @state() private internal = 0;
  private timer: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.internal = this.value;
  }

  disconnectedCallback() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    super.disconnectedCallback();
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("value") && this.value !== this.internal)
      this.internal = this.value;
    if (changed.has("max") && this.internal > this.max) {
      this.internal = this.max;
    }
  }

  private onInput(e: Event) {
    e.stopPropagation();

    const v = Math.max(
      0,
      Math.min(this.max, Number((e.target as HTMLInputElement).value)),
    );
    this.internal = v;

    this.dispatchEvent(
      new CustomEvent("input", {
        detail: { value: v },
        bubbles: true,
        composed: true,
      }),
    );

    if (this.timer) window.clearTimeout(this.timer);

    if (this.debounceMs > 0) {
      this.timer = window.setTimeout(() => {
        this.dispatchEvent(
          new CustomEvent("change", {
            detail: { value: v },
            bubbles: true,
            composed: true,
          }),
        );
        this.timer = null;
      }, this.debounceMs);
    } else {
      this.dispatchEvent(
        new CustomEvent("change", {
          detail: { value: v },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="bots-slider">
        <label class="mb-1 ml-0.5 block text-xs text-zinc-400">
          ${translateText("single_modal.bots")}:
          <span class="font-semibold text-zinc-200">${this.internal}</span>
        </label>
        <input
          type="range"
          min="0"
          .max=${String(this.max)}
          step="1"
          .value=${String(this.internal)}
          @input=${this.onInput}
          class="w-full"
          style=${`--val:${this.max > 0 ? (this.internal / this.max) * 100 : 0}%`}
          aria-label=${translateText("single_modal.bots")}
          aria-valuemin="0"
          aria-valuemax=${String(this.max)}
          aria-valuenow=${String(this.internal)}
        />
        ${this.renderSliderStyles()}
      </div>
    `;
  }
  private renderSliderStyles() {
    return html`<style>
      .bots-slider input[type="range"] {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        background: transparent;
        height: 28px;
        cursor: pointer;
        --val: 0%;
        --accent: #60a5fa;
        --track: #3f3f46;
        --track-h: 8px;
        --thumb: 16px;
      }
      .bots-slider input[type="range"]::-webkit-slider-runnable-track {
        height: var(--track-h);
        border-radius: 9999px;
        background: linear-gradient(
          to right,
          var(--accent) 0%,
          var(--accent) var(--val),
          var(--track) var(--val),
          var(--track) 100%
        );
      }
      .bots-slider input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: var(--thumb);
        height: var(--thumb);
        margin-top: calc((var(--track-h) - var(--thumb)) / 2);
        border-radius: 9999px;
        background: var(--accent);
        border: 2px solid #ffffff55;
      }
      .bots-slider input[type="range"]::-moz-range-track {
        height: var(--track-h);
        border-radius: 9999px;
        background: var(--track);
      }
      .bots-slider input[type="range"]::-moz-range-progress {
        height: var(--track-h);
        border-radius: 9999px 0 0 9999px;
        background: var(--accent);
      }
      .bots-slider input[type="range"]::-moz-range-thumb {
        width: var(--thumb);
        height: var(--thumb);
        border-radius: 9999px;
        background: var(--accent);
        border: 2px solid #ffffff55;
      }
    </style>`;
  }
}
