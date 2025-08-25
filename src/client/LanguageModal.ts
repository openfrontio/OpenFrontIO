/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../client/Utils";

@customElement("language-modal")
export class LanguageModal extends LitElement {
  @property({ type: Boolean }) visible = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @property({ type: Array }) languageList: any[] = [];
  @property({ type: String }) currentLang = "en";

  createRenderRoot() {
    return this; // Use Light DOM for TailwindCSS classes
  }

  private readonly close = () => {
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

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.handleKeyDown);
    document.body.style.overflow = "auto";
  }

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  private readonly selectLanguage = (lang: string) => {
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        bubbles: true,
        composed: true,
        detail: { lang },
      }),
    );
  };

  render() {
    if (!this.visible) return null;

    return html`
      <aside
        class="fixed p-4 z-[1000] inset-0 bg-black/50 overflow-y-auto flex items-center justify-center"
      >
        <div
          class="bg-gray-800/80 dark:bg-gray-900/90 backdrop-blur-md rounded-lg min-w-[340px] max-w-[480px] w-full"
        >
          <header
            class="relative rounded-t-md text-lg bg-black/60 dark:bg-black/80 text-center text-white px-6 py-4 pr-10"
          >
            ${translateText("select_lang.title")}
            <div
              class="cursor-pointer absolute right-4 top-4 font-bold hover:text-gray-300"
              @click=${this.close}
            >
              ✕
            </div>
          </header>

          <section
            class="relative text-white dark:text-gray-100 p-6 max-h-[60dvh] overflow-y-auto"
          >
            ${this.languageList.map((lang) => {
              const isActive = this.currentLang === lang.code;
              const isDebug = lang.code === "debug";

              let buttonClasses =
                "w-full flex items-center gap-2 p-2 mb-2 rounded-md transition-colors duration-300 border";

              if (isDebug) {
                buttonClasses +=
                  " animate-pulse font-bold text-white border-2 border-dashed border-cyan-400 shadow-lg" +
                  " shadow-cyan-400/25 bg-gradient-to-r from-red-600 via-yellow-600 via-green-600 via-blue-600" +
                  " to-purple-600";
              } else if (isActive) {
                buttonClasses +=
                  " bg-gray-400 dark:bg-gray-500 border-gray-300 dark:border-gray-400 text-black dark:text-white";
              } else {
                buttonClasses +=
                  " bg-gray-600 dark:bg-gray-700 border-gray-500 dark:border-gray-600 text-white dark:text-gray-100" +
                  " hover:bg-gray-500 dark:hover:bg-gray-600";
              }

              return html`
                <button
                  class="${buttonClasses}"
                  @click=${() =>
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    this.selectLanguage(lang.code)}
                >
                  <img
                    src="/flags/${lang.svg}.svg"
                    class="w-6 h-4 object-contain"
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
