import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { translateText } from "../../Utils";

/**
 * A customizable button component with accessibility and theming support.
 * @fires o-button-click - Dispatched when the button is clicked and not disabled.
 * @attr {String} title - The button's display text.
 * @attr {String} translationKey - Key for translated text (overrides title).
 * @attr {String} icon - Path to an icon (e.g., 'icons/users.svg').
 * @attr {Boolean} secondary - Use secondary button styling.
 * @attr {Boolean} block - Make the button full-width.
 * @attr {Boolean} blockDesktop - Make the button full-width only on mobile.
 * @attr {Boolean} disable - Disable the button.
 * @attr {String} iconPosition - Float of the icon.
 */
@customElement("o-button")
export class OButton extends LitElement {
  @property({ type: String, reflect: true }) title = "";
  @property({ type: String, reflect: true }) translationKey = "";
  @property({ type: String, reflect: true }) icon = "";
  @property({ type: Boolean, reflect: true }) secondary = false;
  @property({ type: Boolean, reflect: true }) block = false;
  @property({ type: Boolean, reflect: true }) blockDesktop = false;
  @property({ type: Boolean, reflect: true }) disable = false;
  @property({ type: String, reflect: true }) iconPosition: "left" | "right" =
    "left";

  static styles = css`
    .c-button {
      display: flex;
      justify-content: center;
      align-items: center;
      text-align: center;
      background: var(--primary-color);
      color: var(--text-color-light);
      font-family: var(--font-family-base);
      font-size: var(--font-size-base);
      letter-spacing: 1px;
      width: 100%;
      border: 1px solid transparent;
      padding: 0.75rem 1.5rem;
      transition: var(--transition-base);
      cursor: pointer;
      outline: none;
      box-shadow:
        inset -2px -2px 0 0 var(--primary-color),
        inset 2px 2px 0 0 var(--primary-color-lighter);
    }

    .c-button:hover,
    .c-button:active,
    .c-button:focus {
      transform: translate(1px, 1px);
      box-shadow:
        inset -1px -1px 0 0 var(--primary-color),
        inset 1px 1px 0 0 var(--primary-color-lighter);
    }

    .c-button:disabled {
      background: var(--background-color-grey);
      opacity: 0.7;
      cursor: not-allowed;
      transition: var(--transition-base);
    }

    .c-button--secondary {
      background-color: var(--background-color-grey);
      color: var(--text-color-light);
      box-shadow:
        inset -1px -1px 0 0 var(--primary-color),
        inset 1px 1px 0 0 var(--primary-color-lighter);
    }

    .c-button--secondary:hover,
    .c-button--secondary:active,
    .c-button--secondary:focus {
      transform: translate(1px, 1px);
      box-shadow:
        inset -1px -1px 0 0 var(--primary-color),
        inset 1px 1px 0 0 var(--primary-color-lighter);
    }

    .c-button--block {
      display: block;
      width: 100%;
    }
    .c-button--block-desktop {
      display: block;
      width: 100%;
      @media (min-width: var(--breakpoint-desktop)) {
        width: auto;
        margin: 0 auto;
      }
    }

    o-icon.icon-left {
      margin-right: 0.5rem;
      margin-left: 0;
    }

    o-icon.icon-right {
      margin-left: 0.5rem;
      margin-right: 0;
    }

    o-icon[hidden] {
      margin: 0;
    }
  `;

  // Internal click handler
  private _handleClick(event: Event) {
    if (this.disable) return;
    const customEvent = new CustomEvent("o-button-click", {
      detail: { title: this.title, translationKey: this.translationKey },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  render() {
    const buttonText = this.translationKey
      ? translateText(this.translationKey)
      : this.title;

    return html`
      <button
        class=${classMap({
          "c-button": true,
          "c-button--block": this.block,
          "c-button--blockDesktop": this.blockDesktop,
          "c-button--secondary": this.secondary,
          "c-button--disabled": this.disable,
        })}
        ?disabled=${this.disable}
        aria-disabled=${this.disable ? "true" : "false"}
        aria-label=${buttonText}
        @click=${this._handleClick}
      >
        ${this.icon && this.iconPosition === "left"
          ? html`<o-icon
              src="${this.icon}"
              size="medium"
              color="var(--text-color-light)"
              class="icon-left"
            >
            </o-icon>`
          : ""}
        ${buttonText}
        ${this.icon && this.iconPosition === "right"
          ? html`<o-icon
              src="${this.icon}"
              size="medium"
              color="var(--text-color-light)"
              class="icon-right"
            >
            </o-icon>`
          : ""}
      </button>
    `;
  }
}
