import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("o-modal")
export class OModal extends LitElement {
  @state() public isModalOpen = false;
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: Number }) heightRatio?: number;
  @property({ type: Boolean }) disableScroll = false;
  @property({ type: Boolean }) special = false;

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
      background: #23232382;
      border-radius: 8px;
      min-width: 340px;
      max-width: 860px;
    }

    .c-modal__wrapper__special {
      background: #23232382;
      border-radius: 8px;
      min-width: 340px;
      max-width: 1000px;
      display: flex;
      flex-direction: column;
      height: 100%;
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
      position: relative;
      color: #fff;
      padding: 1.4rem;
      max-height: 60dvh;
      overflow-y: scroll;
      backdrop-filter: blur(8px);
    }

    .c-modal__content__special {
      position: relative;
      color: #fff;
      padding: 1.4rem;
      flex-grow: 1;
      max-height: 100%;
      overflow-y: auto;
      backdrop-filter: blur(8px);
    }
  `;
  public open() {
    this.isModalOpen = true;
  }

  public close() {
    this.isModalOpen = false;
    this.dispatchEvent(
      new CustomEvent("modal-close", { bubbles: true, composed: true }),
    );
  }

  render() {
    return html`
      ${this.isModalOpen
        ? html`
            <aside class="c-modal">
              <div
                class="c-modal__wrapper${this.special ? "__special" : ""}"
                style=${`height: ${this.heightRatio ? this.heightRatio * 100 + "vh" : "auto"};`}
              >
                <header class="c-modal__header">
                  ${`${this.translationKey}` === ""
                    ? `${this.title}`
                    : `${translateText(this.translationKey)}`}
                  <div class="c-modal__close" @click=${this.close}>X</div>
                </header>
                <section
                  class="c-modal__content${this.special ? "__special" : ""}"
                  style=${`${this.disableScroll ? "overflow: hidden;" : ""}`}
                >
                  <slot></slot>
                </section>
              </div>
            </aside>
          `
        : html``}
    `;
  }
}
