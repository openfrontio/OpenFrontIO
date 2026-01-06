import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("o-modal")
export class OModal extends LitElement {
  @state() public isModalOpen = false;
  static openCount = 0;
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: Boolean }) alwaysMaximized = false;
  @property({ type: Boolean }) inline = false;
  @property({ type: Function }) onClose?: () => void;

  static styles = css`
    .c-modal {
      position: fixed;
      padding: 0;
      z-index: 9999;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.7);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .c-modal.inline {
      position: relative;
      background-color: transparent;
      z-index: 10;
      inset: auto;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      display: flex;
      align-items: stretch;
    }

    .c-modal__wrapper {
      position: relative;
      border-radius: 8px;
      min-width: 400px;
      max-width: 900px;
      width: 90%;
      margin: 2rem;
      max-height: calc(100vh - 4rem);
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
    }

    .c-modal.inline .c-modal__wrapper {
      max-width: 100%;
      width: 100%;
      height: 100%;
      margin: 0;
      max-height: none;
      display: flex;
      flex-direction: column;
      box-shadow: none;
    }

    .c-modal.inline .c-modal__content {
      overflow-y: auto;
    }

    .c-modal__wrapper.always-maximized {
      width: 90%;
      min-width: 400px;
      max-width: 900px;
      height: auto;
      max-height: calc(100vh - 4rem);
    }

    .c-modal__header {
      position: relative;
      border-top-left-radius: 8px;
      border-top-right-radius: 8px;
      font-size: 18px;
      background: #000000a1;
      text-align: center;
      color: #fff;
      padding: 1rem 2.4rem 1rem 1.4rem;
      flex-shrink: 0;
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
      overflow-y: auto;
      backdrop-filter: blur(8px);
      border-radius: 8px;
      flex: 1;
      min-height: 0;
    }
  `;
  public open() {
    if (!this.isModalOpen) {
      if (!this.inline) {
        OModal.openCount = OModal.openCount + 1;
        if (OModal.openCount === 1) document.body.style.overflow = "hidden";
      }
      this.isModalOpen = true;
    }
  }

  public close() {
    if (this.isModalOpen) {
      this.isModalOpen = false;
      this.onClose?.();
      if (!this.inline) {
        OModal.openCount = Math.max(0, OModal.openCount - 1);
        if (OModal.openCount === 0) document.body.style.overflow = "";
      }
    }
  }

  disconnectedCallback() {
    // Ensure global counter is decremented if this modal is removed while open.
    if (this.isModalOpen && !this.inline) {
      OModal.openCount = Math.max(0, OModal.openCount - 1);
      if (OModal.openCount === 0) document.body.style.overflow = "";
    }
    super.disconnectedCallback();
  }

  render() {
    return html`
      ${this.isModalOpen
        ? html`
            <aside
              class="c-modal ${this.inline ? "inline" : ""}"
              @click=${this.inline ? null : this.close}
            >
              <div
                @click=${(e: Event) => e.stopPropagation()}
                class="c-modal__wrapper ${this.alwaysMaximized
                  ? "always-maximized"
                  : ""}"
              >
                ${this.inline
                  ? html``
                  : html`<div class="c-modal__close" @click=${this.close}>
                      ✕
                    </div>`}
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
