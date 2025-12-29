import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("o-modal")
export class OModal extends LitElement {
  @state() public isModalOpen = false;
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: Boolean }) alwaysMaximized = false;
  @property({ type: Function }) onClose?: () => void;

  static styles = css`
    .c-modal {
      position: fixed;
      padding: 1rem;
      z-index: 9999;
      left: 0;
      bottom: 0;
      right: 0;
      top: 0;
      background-color: rgba(0, 0, 0, 0.5);
      overflow-y: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .c-modal__wrapper {
      border-radius: 8px;
      min-width: 340px;
      max-width: 860px;
    }

    .c-modal__wrapper.always-maximized {
      width: 100%;
      min-width: 340px;
      max-width: 860px;
      min-height: 320px;
      /* Fallback for older browsers */
      height: 60vh;
      /* Use dvh if supported for dynamic viewport handling */
      height: 60dvh;
    }

    .c-modal__header {
      position: relative;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
      font-size: 18px;
      background: #000000a1;
      text-align: center;
      color: #fff;
      padding: 1rem 2.4rem 1rem 1.4rem;
    }

    .c-modal__close {
      cursor: pointer;
      position: absolute;
      right: 1rem;
      top: 1rem;
    }

    .c-modal__content {
      background: #23232382;
      position: relative;
      color: #fff;
      padding: 1.4rem;
      max-height: 60dvh;
      overflow-y: auto;
      backdrop-filter: blur(8px);
    }
  `;

  public open() {
    this.isModalOpen = true;
  }
  public close() {
    if (this.isModalOpen) {
      this.isModalOpen = false;
      this.onClose?.();
    }
  }

  render() {
    return html`
      ${this.isModalOpen
        ? html`
            <aside class="c-modal" @click=${this.close}>
              <div
                @click=${(e: Event) => e.stopPropagation()}
                class="c-modal__wrapper ${this.alwaysMaximized
                  ? "always-maximized"
                  : ""}"
              >
                <header class="c-modal__header">
                  ${`${this.translationKey}` === ""
                    ? `${this.title}`
                    : `${translateText(this.translationKey)}`}
                  <div class="c-modal__close" @click=${this.close}>✕</div>
                </header>
                <section class="c-modal__content">
                  <slot></slot>
                </section>
              </div>
            </aside>
          `
        : html``}
    `;
  }
}
