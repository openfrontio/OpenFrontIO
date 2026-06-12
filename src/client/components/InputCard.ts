import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
import { CARD_LABEL_CLASS, cardClass, INPUT_CLASS } from "./InputCardStyles";

@customElement("input-card")
export class InputCard extends LitElement {
  @property({ attribute: false }) labelKey = "";
  @property({ attribute: false }) inputId?: string;
  @property({ attribute: false }) inputType = "number";
  @property({ attribute: false }) inputMin?: number | string;
  @property({ attribute: false }) inputMax?: number | string;
  @property({ attribute: false }) inputStep?: number | string;
  @property({ attribute: false }) inputValue?: number | string;
  @property({ attribute: false }) inputAriaLabel?: string;
  @property({ attribute: false }) inputPlaceholder?: string;
  @property({ attribute: false }) onInput?: (e: Event) => void;
  @property({ attribute: false }) onChange?: (e: Event) => void;
  @property({ attribute: false }) onKeyDown?: (e: KeyboardEvent) => void;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="${cardClass(true)}">
        <div
          class="w-full h-full p-3 flex flex-col items-center justify-between gap-2"
        >
          <div class="h-[30px] my-1"></div>

          <span class="${CARD_LABEL_CLASS} text-center text-white">
            ${translateText(this.labelKey)}
          </span>
        </div>

        <div class="absolute left-3 right-3 top-1/2 -translate-y-1/2 z-10">
          <input
            type=${this.inputType}
            id=${this.inputId ?? nothing}
            min=${this.inputMin ?? nothing}
            max=${this.inputMax ?? nothing}
            step=${this.inputStep ?? nothing}
            .value=${String(this.inputValue ?? "")}
            class=${INPUT_CLASS}
            aria-label=${this.inputAriaLabel ?? nothing}
            placeholder=${this.inputPlaceholder ?? nothing}
            @input=${this.onInput}
            @change=${this.onChange}
            @keydown=${this.onKeyDown}
          />
        </div>
      </div>
    `;
  }
}
