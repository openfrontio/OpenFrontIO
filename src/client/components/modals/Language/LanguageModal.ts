import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../../Utils";

@customElement("language-modal")
export class LanguageModal extends LitElement {
  @property({ type: Boolean }) isModalOpen = false;
  @property({ type: Array }) languageList: any[] = [];
  @property({ type: String }) currentLang = "en";
  @state() private searchQuery = "";

  createRenderRoot() {
    return this;
  }

  public open() {
    this.isModalOpen = true;
  }

  public close() {
    this.isModalOpen = false;
  }

  private handleSearch = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.searchQuery = input.value;
  };

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

  private getFilteredLanguages() {
    if (!this.searchQuery) return this.languageList;
    return this.languageList.filter(
      (lang) =>
        lang.native.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        lang.en.toLowerCase().includes(this.searchQuery.toLowerCase()),
    );
  }

  render() {
    const filteredLanguages = this.getFilteredLanguages();
    return html`
      <o-modal
        .isModalOpen=${this.isModalOpen}
        .title=${translateText("select_lang.title")}
        .disableContentScroll=${true}
        @modal-close=${this.close}
      >
        <div class="flex flex-col h-[70vh] max-h-[70vh]">
          <div class="background-panel p-4 mb-4 flex-shrink-0">
            <div class="relative flex items-center">
              <div class="absolute left-3 text-textGrey w-[18px] h-[18px]">
                <o-icon
                  src="icons/search.svg"
                  size="medium"
                  color="var(--text-color-grey)"
                ></o-icon>
              </div>

              <input
                type="text"
                class="w-full py-2 px-4 pl-10 bg-backgroundDarkLighter border border-borderBase text-textLight font-pixel text-small outline-none transition-colors duration-200 placeholder:text-textGrey focus:border-primary"
                placeholder=${translateText("common.search_placeholder")}
                .value=${this.searchQuery}
                @input=${this.handleSearch}
              />
            </div>
          </div>
          <div class="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
            ${filteredLanguages.map((lang) => {
              const isActive = this.currentLang === lang.code;
              const debugClass =
                lang.code === "debug"
                  ? "font-bold text-textLight border-2 border-dashed border-cyan-400 shadow-[0_0_4px_cyan]"
                  : "";
              const activeClass = isActive
                ? " !bg-backgroundDarkLighter !border-none"
                : "";
              const hoverClass = isActive
                ? ""
                : "hover:bg-backgroundGrey hover:text-textLight";

              return html`
                <button
                  class="background-panel flex items-center gap-3 p-4 font-pixel text-small leading-5 transition-all duration-200 text-left border-none text-textGrey cursor-pointer w-full mb-2 relative ${activeClass} ${hoverClass} ${debugClass} hover:after:opacity-100 after:content-[''] after:absolute after:right-4 after:w-2 after:h-2 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity after:duration-200 "
                  @click=${() => this.selectLanguage(lang.code)}
                >
                  <img
                    src="/flags/${lang.svg}.svg"
                    class="w-8 h-6 object-cover rounded-sm"
                    alt="${lang.code}"
                  />
                  <div class="flex flex-col">
                    <span>${lang.native}</span>
                    ${lang.native !== lang.en
                      ? html`<span class="text-textGrey text-xsmall"
                          >${lang.en}</span
                        >`
                      : ""}
                  </div>
                </button>
              `;
            })}
          </div>
        </div>
      </o-modal>
    `;
  }
}
