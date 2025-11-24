import { css, html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

@customElement("bot-slider-card")
export class BotSliderCard extends LitElement {
  @property({ type: Number }) bots: number = 0;
  @property({ type: Boolean }) editable: boolean = false;
  @property({ attribute: false }) onBotsChange?: (value: number) => void;

  static styles = css`
    :host {
      display: contents;
    }

    .option-card {
      width: 100%;
      min-width: 6.25rem;
      max-width: 7.5rem;
      padding: 0.25rem 0.25rem 0 0.25rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      background: rgba(30, 30, 30, 0.95);
      border: 0.125rem solid rgba(255, 255, 255, 0.1);
      border-radius: 0.5rem;
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    }

    .option-card:hover {
      transform: translateY(-0.125rem);
      border-color: rgba(255, 255, 255, 0.3);
      background: rgba(40, 40, 40, 0.95);
    }

    .option-card.selected {
      border-color: #4a9eff;
      background: rgba(74, 158, 255, 0.1);
    }

    .option-card-title {
      font-size: 0.875rem;
      color: #aaa;
      text-align: center;
      margin: 0 0 0.25rem 0;
    }

    input[type="range"] {
      width: 90%;
      accent-color: #4a9eff;
      cursor: pointer;
    }

    input[type="range"]:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }
  `;

  render() {
    if (this.editable) {
      return html`
        <label for="bots-count" class="option-card">
          <input
            type="range"
            id="bots-count"
            min="0"
            max="400"
            step="1"
            @input=${this.handleInput}
            @change=${this.handleChange}
            .value="${String(this.bots)}"
          />
          <div class="option-card-title">
            <span>${translateText("host_modal.bots")} </span>
            ${this.bots === 0
          ? translateText("host_modal.bots_disabled")
          : this.bots}
          </div>
        </label>
      `;
    } else {
      return html`
        <div
          class="option-card ${this.bots > 0 ? "selected" : ""}"
          style="pointer-events: none;"
        >
          <input
            type="range"
            min="0"
            max="400"
            step="1"
            .value="${String(this.bots)}"
            disabled
          />
          <div class="option-card-title">
            <span>${translateText("host_modal.bots")} </span>
            ${this.bots === 0
          ? translateText("host_modal.bots_disabled")
          : this.bots}
          </div>
        </div>
      `;
    }
  }

  private handleInput(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (this.onBotsChange) {
      this.onBotsChange(value);
    }
  }

  private handleChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (this.onBotsChange) {
      this.onBotsChange(value);
    }
  }
}
