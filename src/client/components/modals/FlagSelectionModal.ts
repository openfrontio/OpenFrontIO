import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";
import Countries from "../../data/countries.json";

const flagKey: string = "flag";

@customElement("flag-modal")
export class FlagSelectionModal extends LitElement {
  @property({ type: Boolean }) isModalOpen = false;
  @state() private flag: string = "";
  @state() private searchQuery: string = "";

  public open() {
    this.isModalOpen = true;
  }

  public close() {
    this.isModalOpen = false;
  }

  public getCurrentFlag(): string {
    return this.flag;
  }

  createRenderRoot() {
    return this;
  }

  private handleSearch = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this.searchQuery = input.value;
  };

  private setFlag = (countryCode: string) => {
    this.flag = countryCode;
    this.storeFlag(countryCode);
    this.dispatchFlagEvent();
    this.close();
  };

  private getStoredFlag(): string {
    const storedFlag = localStorage.getItem(flagKey);
    if (storedFlag) {
      return storedFlag;
    }
    return "";
  }

  private storeFlag(flag: string) {
    if (flag) {
      localStorage.setItem(flagKey, flag);
    } else if (flag === "") {
      localStorage.removeItem(flagKey);
    }
  }

  private dispatchFlagEvent() {
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag: this.flag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private getFilteredCountries() {
    let filtered = Countries;
    if (this.searchQuery) {
      filtered = Countries.filter(
        (country) =>
          country.name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
          country.code.toLowerCase().includes(this.searchQuery.toLowerCase()),
      );
    }

    // Sort to prioritize the selected flag first and 'xx' second
    return filtered.sort((a, b) => {
      if (this.flag === a.code) return -1;
      if (this.flag === b.code) return 1;
      if (a.code === "xx") return -1;
      if (b.code === "xx") return 1;
      return 0;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.flag = this.getStoredFlag();
    this.dispatchFlagEvent();
  }

  render() {
    const filteredCountries = this.getFilteredCountries();

    return html`
      <o-modal
        .isModalOpen=${this.isModalOpen}
        .title=${translateText("select_flag.title")}
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
            ${filteredCountries.map((country) => {
              const isActive = this.flag === country.code;
              const activeClass = isActive
                ? " !bg-backgroundDarkLighter !border-none"
                : "";
              const hoverClass = isActive
                ? ""
                : "hover:bg-backgroundGrey hover:text-textLight";

              return html`
                <button
                  class="background-panel flex items-center gap-3 p-4 font-pixel text-small leading-5 transition-all duration-200 text-left border-none text-textGrey cursor-pointer w-full mb-2 relative ${activeClass} ${hoverClass} hover:after:opacity-100 after:content-[''] after:absolute after:right-4 after:w-2 after:h-2 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity after:duration-200"
                  @click=${() => this.setFlag(country.code)}
                >
                  <img
                    src="/flags/${country.code}.svg"
                    class="w-8 h-6 object-cover rounded-sm"
                    alt="${country.code}"
                  />
                  <div class="flex flex-col">
                    <span>${country.name}</span>
                    <span class="text-textGrey text-xsmall"
                      >${country.code.toUpperCase()}</span
                    >
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
@customElement("flag-trigger-button")
export class FlagTriggerButton extends LitElement {
  @state() private currentFlag: string = "";

  private openModal() {
    const modal = document.querySelector("flag-modal") as FlagSelectionModal;
    if (modal) {
      modal.open();
    }
  }

  private updateFlag = (e: CustomEvent) => {
    this.currentFlag = e.detail.flag;
  };
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("flag-change", this.updateFlag as EventListener);
    const modal = document.querySelector("flag-modal") as FlagSelectionModal;
    if (modal) {
      this.currentFlag = modal.getCurrentFlag();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      "flag-change",
      this.updateFlag as EventListener,
    );
  }

  render() {
    return html`
      <button
        @click=${this.openModal}
        class="background-panel trigger-button relative h-full px-4 py-3 flex items-center justify-center min-w-[52px] transition-all cursor-pointer border-none text-textLight hover:bg-backgroundDarkLighter"
        title="Pick a flag!"
      >
        <o-icon
          src="icons/flag.svg"
          size="medium"
          color="var(--text-color-white)"
        ></o-icon>
        ${this.currentFlag
          ? html`
              <div class="absolute top-1 right-1 w-5 h-3 shadow-md">
                <img
                  src="/flags/${this.currentFlag}.svg"
                  alt="${this.currentFlag}"
                  class="w-full h-full object-cover "
                />
              </div>
            `
          : html`
              <div class="absolute top-1 right-1 w-5 h-3 shadow-md">
                <img
                  src="/flags/xxx.svg"
                  alt="default"
                  class="w-full h-full object-cover "
                />
              </div>
            `}
      </button>
    `;
  }
}
