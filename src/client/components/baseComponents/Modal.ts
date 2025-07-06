import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";
import { sharedKeyframes } from "../../styles/core/SharedKeyframes";
/**
 * A customizable modal component
 * @fires modal-close - Dispatched when the modal is closed (after fade-out animation).
 * @attr {Boolean} isModalOpen - Controls whether the modal is visible.
 * @attr {String} title - The modal's display title in the header.
 * @attr {String} translationKey - Key for translated title text (overrides title).
 * @attr {Boolean} disableContentScroll - Disables scrolling of the modal content.
 * @attr {String} width - Sets the modal width ('small', 'medium', 'large').
 * @attr {Boolean} closeOnOutsideClick - Enables/disables closing when clicking outside (default: true).
 */
@customElement("o-modal")
export class OModal extends LitElement {
  @state() public isModalOpen = false;
  @state() private isClosing = false;
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: Boolean }) disableContentScroll = false;
  @property({ type: String }) width = "medium";
  @property({ type: Boolean }) closeOnOutsideClick = true;

  static styles = [
    sharedKeyframes,
    css`
      .c-modal {
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        inset: 0;
        overflow: auto;
        font-family: var(--font-family-base);
        z-index: var(--z-index-modal);
        background: var(--background-color-dark);
        backdrop-filter: blur(var(--blur-md));
        opacity: 0;
        will-change: opacity, transform; /* Optimize animations */
        animation: fade-in var(--animation-base);
      }

      .c-modal.closing {
        animation: fade-out var(--animation-base);
      }

      .c-modal__wrapper {
        position: relative;
        margin: auto;
        width: 100%;
        background: var(--background-color-dark);
        backdrop-filter: blur(var(--blur-md));
        border: 1px solid var(--border-color-base);
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.1),
          0 2px 4px -1px rgba(0, 0, 0, 0.06);
        padding: 1.5rem;
        transform: scale(0.95);
        animation: scale-in var(--animation-base);
        outline: none;
      }

      .c-modal.closing .c-modal__wrapper {
        animation: scale-out var(--animation-base);
      }

      /* Width variants */
      .c-modal__wrapper.width-small {
        max-width: 30rem;
      }

      .c-modal__wrapper.width-medium {
        max-width: 42rem;
      }

      .c-modal__wrapper.width-large {
        max-width: 75rem;
      }

      .c-modal__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
      }

      .c-modal__header h2 {
        font-size: var(--font-size-large);
        color: var(--text-color-light);
        font-family: var(--font-family-base);
        line-height: 2rem;
        margin: 0;
        letter-spacing: 1px;
      }

      .c-modal__close {
        cursor: pointer;
        color: var(--text-color-grey);
        transition: var(--transition-base);
      }

      .c-modal__close:hover {
        color: var(--text-color-light);
      }

      .c-modal__content {
        color: var(--text-color-light);
      }

      .c-modal__content:not(.no-scroll) {
        max-height: 60dvh;
        overflow-y: auto;
        overflow-x: hidden;
      }
    `,
  ];
  // Handler for clicking outside the modal to close it
  private handleClickOutside = (e: Event) => {
    if (!this.closeOnOutsideClick) return;
    const target = e.target as Node;
    const modalBackdrop = this.shadowRoot?.querySelector(".c-modal");
    const modalWrapper = this.shadowRoot?.querySelector(".c-modal__wrapper");
    if (modalBackdrop && modalWrapper && target === modalBackdrop) {
      this.close();
    }
  };

  // Handler for closing the modal with the Escape key
  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isModalOpen) {
      this.close();
    }
  };

  // Handler for animation end to finalize closing
  handleAnimationEnd = (e: AnimationEvent) => {
    if (e.animationName === "scale-out" && this.isClosing) {
      this.isModalOpen = false;
      this.isClosing = false;
      this.dispatchEvent(
        new CustomEvent("modal-close", { bubbles: true, composed: true }),
      );
    }
  };

  // Opens the modal with fade-in and scale-in animations
  public open() {
    this.isClosing = false;
    this.isModalOpen = true;
    this.updateComplete.then(() => {
      const modalWrapper = this.shadowRoot?.querySelector(".c-modal__wrapper");
      if (modalWrapper instanceof HTMLElement) {
        modalWrapper.focus();
      }
    });
  }

  // Initiates the closing process with fade-out and scale-out animations
  public close() {
    this.isClosing = true;
    this.requestUpdate();
  }

  // Sets up event listeners and initial focus after first render
  firstUpdated() {
    this.shadowRoot?.addEventListener("click", this.handleClickOutside);
    this.shadowRoot?.addEventListener("animationend", this.handleAnimationEnd);
    this.addEventListener("keydown", this.handleKeyDown);

    this.updateComplete.then(() => {
      const modalWrapper = this.shadowRoot?.querySelector(".c-modal__wrapper");
      if (modalWrapper instanceof HTMLElement) {
        modalWrapper.tabIndex = 0;
        modalWrapper.focus();
      }
    });
  }

  // Cleans up event listeners when the component is removed
  disconnectedCallback() {
    super.disconnectedCallback();
    this.shadowRoot?.removeEventListener("click", this.handleClickOutside);
    this.shadowRoot?.removeEventListener(
      "animationend",
      this.handleAnimationEnd,
    );
    this.removeEventListener("keydown", this.handleKeyDown);
  }

  render() {
    return html`
      ${this.isModalOpen
        ? html`
            <aside class="c-modal ${this.isClosing ? "closing" : ""}">
              <div
                class="c-modal__wrapper custom-scrollbar width-${this.width}"
                tabindex="0"
              >
                <header class="c-modal__header">
                  <h2>
                    ${this.translationKey === ""
                      ? this.title
                      : translateText(this.translationKey)}
                  </h2>
                  <div class="c-modal__close" @click=${this.close}>
                    <o-icon
                      src="icons/x.svg"
                      size="large"
                      color="var(--text-color-grey)"
                    ></o-icon>
                  </div>
                </header>
                <section
                  class="c-modal__content ${this.disableContentScroll
                    ? "no-scroll"
                    : ""}"
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
