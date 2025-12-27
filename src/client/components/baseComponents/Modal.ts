import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("o-modal")
export class OModal extends LitElement {
  @state() public isModalOpen = false;
  @state() private isDarkMode = true;
  @property({ type: String }) title = "";
  @property({ type: String }) translationKey = "";
  @property({ type: Boolean }) alwaysMaximized = false;
  @property({ type: Function }) onClose?: () => void;

  private themeObserver: MutationObserver | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.updateTheme();
    // Watch for class changes on documentElement to detect theme switches
    this.themeObserver = new MutationObserver(() => this.updateTheme());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.themeObserver?.disconnect();
  }

  private updateTheme() {
    this.isDarkMode = document.documentElement.classList.contains("dark");
  }

  static styles = css`
    .c-modal {
      position: fixed;
      padding: 1rem;
      z-index: 9999;
      left: 0;
      bottom: 0;
      right: 0;
      top: 0;
      background-color: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
      overflow-y: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Dark theme (default) */
    .c-modal__wrapper {
      border-radius: 16px;
      min-width: 340px;
      max-width: 860px;
      overflow: hidden;
      box-shadow:
        0 25px 50px -12px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.1);
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
      border-top-left-radius: 16px;
      border-top-right-radius: 16px;
      font-size: 18px;
      font-weight: 600;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(12px);
      text-align: center;
      color: #fff;
      padding: 1.2rem 2.4rem 1.2rem 1.4rem;
    }

    .c-modal__close {
      cursor: pointer;
      position: absolute;
      right: 1rem;
      top: 50%;
      transform: translateY(-50%);
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: background 0.2s ease;
    }

    .c-modal__close:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .c-modal__content {
      background: rgba(35, 35, 35, 0.85);
      backdrop-filter: blur(12px);
      position: relative;
      color: #fff;
      padding: 1.4rem;
      max-height: 60dvh;
      overflow-y: auto;
      border-bottom-left-radius: 16px;
      border-bottom-right-radius: 16px;
    }

    /* Light theme */
    .c-modal__wrapper.light {
      box-shadow:
        0 10px 25px -5px rgba(0, 0, 0, 0.1),
        0 0 0 1px rgba(0, 0, 0, 0.05);

      /* CSS variables for child components */
      --modal-bg: #f0f9ff;
      --modal-header-bg: rgb(29 180 236 / 95%);
      --modal-text: #1a1a1a;
      --modal-text-muted: #666;
      --modal-border: rgba(0, 0, 0, 0.08);
      --modal-hover: rgba(0, 0, 0, 0.04);
      --modal-card-bg: #ffffff;
      --modal-card-border: rgba(0, 0, 0, 0.08);
      --setting-item-hover: rgba(0, 0, 0, 0.06);
      --tab-active-bg: rgba(0, 0, 0, 0.06);
      --setting-item-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      --group-bg: rgba(0, 0, 0, 0.04);
      --group-header-bg: rgba(0, 0, 0, 0.08);
    }

    .c-modal__wrapper.light .c-modal__header {
      background: rgb(29 180 236 / 95%);
      color: #ffffff;
    }

    .c-modal__wrapper.light .c-modal__close:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .c-modal__wrapper.light .c-modal__content {
      background: #f0f9ff;
      color: #1a1a1a;
    }

    /* Dark theme CSS variables (default) */
    .c-modal__wrapper {
      --modal-bg: rgba(35, 35, 35, 0.85);
      --modal-header-bg: rgba(0, 0, 0, 0.85);
      --modal-text: #fff;
      --modal-text-muted: #888;
      --modal-border: rgba(255, 255, 255, 0.1);
      --modal-hover: rgba(255, 255, 255, 0.1);
      --modal-card-bg: rgba(0, 0, 0, 0.2);
      --modal-card-border: rgba(255, 255, 255, 0.05);
      --setting-item-hover: rgba(255, 255, 255, 0.15);
      --tab-active-bg: rgba(255, 255, 255, 0.1);
      --setting-item-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
      --group-bg: rgba(0, 0, 0, 0.15);
      --group-header-bg: rgba(0, 0, 0, 0.25);
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
    const wrapperClasses = [
      "c-modal__wrapper",
      this.alwaysMaximized ? "always-maximized" : "",
      !this.isDarkMode ? "light" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return html`
      ${this.isModalOpen
        ? html`
            <aside class="c-modal" @click=${this.close}>
              <div
                @click=${(e: Event) => e.stopPropagation()}
                class="${wrapperClasses}"
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
