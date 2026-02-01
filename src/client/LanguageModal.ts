import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";

interface LanguageOption {
  code: string;
  svg: string;
  native: string;
  en: string;
}

@customElement("language-modal")
export class LanguageModal extends BaseModal {
  @property({ type: Array }) languageList: LanguageOption[] = [];
  @property({ type: String }) currentLang = "en";

  private selectLanguage = (lang: string) => {
    this.dispatchEvent(
      new CustomEvent("language-selected", {
        detail: { lang },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  };

  render() {
    const content = html`
      <div
        class="h-full flex flex-col bg-black/70 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden select-none"
      >
        <!-- Header -->
        ${modalHeader({
          title: translateText("select_lang.title"),
          onBack: this.close,
          ariaLabel: translateText("common.back"),
        })}

        <div
          class="flex-1 overflow-y-auto custom-scrollbar p-2"
        >
          <div
            class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
          >
            ${this.languageList.map((lang) => {
              const isActive = this.currentLang === lang.code;
              const isDebug = lang.code === "debug";

              let buttonClasses =
                "relative group rounded-xl border transition-all duration-200 flex items-center p-3 gap-3 w-full cursor-pointer";

              if (isDebug) {
                buttonClasses +=
                  " animate-pulse font-bold text-white border-2 border-dashed border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] bg-gradient-to-r from-red-600 via-yellow-600 via-green-600 via-blue-600 to-purple-600";
              } else if (isActive) {
                buttonClasses += " bg-blue-500/20 border-blue-500/50";
              } else {
                buttonClasses +=
                  " bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";
              }

              return html`
                <button
                  class="${buttonClasses}"
                  @click=${() => this.selectLanguage(lang.code)}
                >
                  <img
                    src="/flags/${lang.svg}.svg"
                    class="w-8 h-6 object-contain shadow-sm rounded-sm shrink-0"
                    alt="${lang.code}"
                  />
                  <div class="flex flex-col items-start min-w-0">
                    <span
                      class="text-sm font-bold uppercase tracking-wider whitespace-normal break-words w-full text-left ${isActive
                        ? "text-white"
                        : "text-gray-200 group-hover:text-white"}"
                      >${lang.native}</span
                    >
                    <span
                      class="text-xs text-white/40 uppercase tracking-widest group-hover:text-white/60 transition-colors whitespace-normal break-words w-full text-left"
                      >${lang.en}</span
                    >
                  </div>

                  ${isActive
                    ? html`
                        <div class="ml-auto text-blue-400 shrink-0">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            class="w-5 h-5"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </div>
                      `
                    : ""}
                </button>
              `;
            })}
            </div>
          </div>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        title=${translateText("select_lang.title")}
        ?inline=${this.inline}
        .onClose=${this.close.bind(this)}
        hideHeader
        hideCloseButton
      >
        ${content}
      </o-modal>
    `;
  }
}
