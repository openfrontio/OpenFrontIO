import { css, html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

/**
 * A specialized card component for the Max Timer option
 * Displays a checkbox and a number input when checked
 */
@customElement("max-timer-card")
export class MaxTimerCard extends LitElement {
  /**
   * Unique identifier for the checkbox input
   */
  @property({ type: String }) inputId: string = "max-timer";

  /**
   * Current value of the timer (undefined if disabled)
   */
  @property({ type: Number }) value?: number;

  /**
   * Whether the option is editable
   */
  @property({ type: Boolean }) editable: boolean = false;

  /**
   * Callback when the checkbox is toggled
   */
  @property({ attribute: false }) onToggle?: (enabled: boolean) => void;

  /**
   * Callback when the timer value changes
   */
  @property({ attribute: false }) onValueChange?: (value: number) => void;

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

    .option-card input[type="checkbox"] {
      opacity: 0;
      position: absolute;
      pointer-events: none;
    }

    label.option-card:hover {
      transform: none;
    }

    .checkbox-icon {
      width: 1rem;
      height: 1rem;
      border: 0.125rem solid #aaa;
      border-radius: 0.375rem;
      margin: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease-in-out;
    }

    .option-card.selected .checkbox-icon {
      border-color: #4a9eff;
      background: #4a9eff;
    }

    .option-card.selected .checkbox-icon::after {
      content: "✓";
      color: white;
    }

    input[type="number"] {
      width: 60px;
      color: black;
      text-align: right;
      border-radius: 8px;
      padding: 2px 4px;
      border: 1px solid #ccc;
    }
  `;

  render(): TemplateResult {
    const isEnabled = this.value !== undefined;

    if (this.editable) {
      return html`
      <div
        class="option-card ${isEnabled ? "selected" : ""}"
        @click=${this.handleCardClick}
      >
        <div class="checkbox-icon"></div>
        ${isEnabled
          ? html`<input
                type="number"
                id="${this.inputId}-value"
                min="0"
                max="120"
                .value=${String(this.value ?? "")}
                @input=${this.handleValueInput}
                @keydown=${this.handleKeyDown}
                @click=${(e: Event) => e.stopPropagation()}
              />`
          : ""}
        <div class="option-card-title">
          ${translateText("host_modal.max_timer")}
        </div>
      </div>
    `;
    } else {
      return html`
        <div
          class="option-card ${isEnabled ? "selected" : ""}"
          style="pointer-events: none;"
        >
          <div class="checkbox-icon"></div>
          ${isEnabled
          ? html`<span style="margin-right: 8px; font-weight: bold;"
                >${this.value}</span
              >`
          : ""}
          <div class="option-card-title">
            ${translateText("host_modal.max_timer")}
          </div>
        </div>
      `;
    }
  }

  private handleCardClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (this.onToggle) {
      this.onToggle(this.value === undefined);
    }
  }

  private handleValueInput(e: Event) {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[e+-]/gi, "");
    const val = parseInt(input.value);

    if (isNaN(val) || val < 0 || val > 120) {
      return;
    }

    if (this.onValueChange) {
      this.onValueChange(val);
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (["-", "+", "e"].includes(e.key)) {
      e.preventDefault();
    }
  }
}
