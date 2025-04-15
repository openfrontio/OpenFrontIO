import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../client/Utils";

@customElement("language-modal")
export class LanguageModal extends LitElement {
  @property({ type: Boolean }) visible = false;
  @property({ type: Array }) languageList: any[] = [];
  @property({ type: String }) currentLang = "en";

  static styles = css`
    .c-modal {
      position: fixed;
      padding: 1rem;
      z-index: 1000;
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
      max-width: 480px;
      width: 100%;
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
      font-weight: bold;
    }

    .c-modal__content {
      position: relative;
      color: #fff;
      padding: 1.4rem;
      max-height: 60dvh;
      overflow-y: auto;
      backdrop-filter: blur(8px);
    }

    .lang-button {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      margin-bottom: 0.5rem;
      border-radius: 0.375rem;
      transition: background-color 0.3s;
      border: 1px solid #aaa;
      background-color: #505050;
      color: #fff;
    }

    .lang-button:hover {
      background-color: #969696;
    }

    .lang-button.active {
      background-color: #aaaaaa;
      border-color: #bbb;
      color: #000;
    }

    .flag-icon {
      width: 24px;
      height: 16px;
      object-fit: contain;
    }

    @keyframes rainbow {
      0% {
        background-color: #990033;
      }
      20% {
        background-color: #996600;
      }
      40% {
        background-color: #336600;
      }
      60% {
        background-color: #008080;
      }
      80% {
        background-color: #1c3f99;
      }
      100% {
        background-color: #5e0099;
      }
    }

    .lang-button.debug {
      animation: rainbow 10s infinite;
      font-weight: bold;
      color: #fff;
      border: 2px dashed aqua;
      box-shadow: 0 0 4px aqua;
    }
  `;

  private close = () => {
    this.dispatchEvent(
      new CustomEvent("close-modal", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  updated(changedProps: Map<string, unknown>) {
    if (changedProps.has("visible")) {
      if (this.visible) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "auto";
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.body.style.overflow = "auto";
  }

  private selectLanguage = (lang: string) => {
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        detail: { lang },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    if (!this.visible) return null;

    return html`
      <aside class="c-modal">
        <div class="c-modal__wrapper">
          <header class="c-modal__header">
            ${translateText("select_lang.title")}
            <div class="c-modal__close" @click=${this.close}>X</div>
          </header>

          <section class="c-modal__content">
            ${this.languageList.map((lang) => {
              const isActive = this.currentLang === lang.code;
              return html`
                <button
                  class="lang-button ${isActive ? "active" : ""} ${lang.code ===
                  "debug"
                    ? "debug"
                    : ""}"
                  @click=${() => this.selectLanguage(lang.code)}
                >
                  <img
                    src="/flags/${lang.svg}.svg"
                    class="flag-icon"
                    alt="${lang.code}"
                  />
                  <span>${lang.native} (${lang.en})</span>
                </button>
              `;
            })}
          </section>
        </div>
      </aside>
    `;
  }
}
