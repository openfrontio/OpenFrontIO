import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("language-modal")
export class LanguageModal extends LitElement {
  @property({ type: Boolean }) visible = false;
  @property({ type: Array }) languageList: any[] = [];
  @property({ type: String }) currentLang = "en";

  static styles = css`
    .modal {
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 50;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .hidden {
      display: none;
    }
    .modal-content {
      background: white;
      border-radius: 0.5rem;
      box-shadow: 0 10px 15px rgba(0, 0, 0, 0.2);
      padding: 1.5rem;
      width: 24rem;
      max-width: 100%;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }

    .language-list {
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      margin-bottom: 1rem;
    }

    .lang-button {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border-radius: 0.375rem;
      transition: background-color 0.3s;
      border: 1px solid #ccc;
      background-color: #f8f8f8;
    }

    .lang-button:hover {
      background-color: #ebf8ff;
    }

    .lang-button.active {
      background-color: #bee3f8;
    }

    .flag-icon {
      width: 24px;
      height: 16px;
      object-fit: contain;
    }

    .close-button {
      background-color: #3182ce;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      cursor: pointer;
      font-weight: bold;
      border: none;
    }

    .close-button:hover {
      background-color: #2b6cb0;
    }
  `;

  private selectLanguage(lang: string) {
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        detail: { lang },
        bubbles: true,
        composed: true,
      }),
    );
  }

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

  render() {
    return html`
      <div class="modal ${this.visible ? "" : "hidden"}">
        <div class="modal-content">
          <h2 class="text-xl font-semibold mb-4">Select Language</h2>

          <div class="language-list">
            ${this.languageList.map((lang) => {
              const isActive = this.currentLang === lang.code;
              return html`
                <button
                  class="lang-button ${isActive ? "active" : ""}"
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
          </div>

          <button
            class="close-button"
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent("close-modal", {
                  bubbles: true,
                  composed: true,
                }),
              )}
          >
            Close
          </button>
        </div>
      </div>
    `;
  }
}
