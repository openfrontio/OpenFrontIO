import { css, html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * A reusable checkbox card component for game options
 * Displays a checkbox with label in a card-style layout
 * Supports both editable and read-only modes
 */
@customElement("checkbox-card")
export class CheckboxCard extends LitElement {
  /**
   * Unique identifier for the checkbox input
   */
  @property({ type: String }) inputId: string = "";

  /**
   * Display label text for the checkbox
   */
  @property({ type: String }) label: string = "";

  /**
   * Current checked state of the checkbox
   */
  @property({ type: Boolean }) checked: boolean = false;

  /**
   * Whether the checkbox should be editable (true) or read-only (false)
   */
  @property({ type: Boolean }) editable: boolean = false;

  /**
   * Optional custom width for the card (e.g., "8.75rem")
   */
  @property({ type: String }) width?: string;

  /**
   * Optional custom styles for the title
   */
  @property({ type: String }) titleStyle?: string;

  /**
   * Callback function when checkbox state changes
   */
  @property({ attribute: false }) onChange?: (checked: boolean) => void;

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
      display: none;
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
  `;

  render(): TemplateResult {
    if (this.editable) {
      return this.renderEditable();
    } else {
      return this.renderReadOnly();
    }
  }

  /**
   * Renders the editable (interactive) version of the checkbox card
   */
  private renderEditable(): TemplateResult {
    const style = this.width ? `width: ${this.width};` : "";

    return html`
      <label
        for="${this.inputId}"
        class="option-card ${this.checked ? "selected" : ""}"
        style="${style}"
      >
        <div class="checkbox-icon"></div>
        <input
          type="checkbox"
          id="${this.inputId}"
          @change=${(e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            if (this.onChange) {
              this.onChange(checked);
            }
          }}
          .checked=${this.checked}
        />
        <div class="option-card-title" style="${this.titleStyle ?? ""}">
          ${this.label}
        </div>
      </label>
    `;
  }

  /**
   * Renders the read-only version of the checkbox card
   */
  private renderReadOnly(): TemplateResult {
    const style = this.width ? `width: ${this.width};` : "";

    return html`
      <div
        class="option-card ${this.checked ? "selected" : ""}"
        style="pointer-events: none; ${style}"
      >
        <div class="option-card-title" style="${this.titleStyle ?? ""}">
          ${this.label}
        </div>
      </div>
    `;
  }
}
