import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import Countries from "./data/countries.json";
import { getTranslatedCountryName } from "./Utils";

@customElement("flag-input-modal")
export class FlagInputModal extends LitElement {
  @query("o-modal") private readonly modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private search = "";
  @state() private isModalOpen = false;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <o-modal title="Flag Selector Modal" alwaysMaximized>
        <input
          class="h-[2rem] border-none border border-gray-300
          rounded-xl shadow-sm text-2xl text-center focus:outline-none
          focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black
          dark:border-gray-300/60 dark:bg-gray-700 dark:text-white"

          type="text"
          placeholder="Search..."
          @change=${this.handleSearch}
          @keyup=${this.handleSearch}
        />
        <div
          class="flex flex-wrap justify-evenly gap-[1rem] overflow-y-auto overflow-x-hidden h-[90%]"
        >
          ${this.isModalOpen ? Countries.filter(
            (country) => !country.restricted && this.includedInSearch(country),
          ).map(
            (country) => html`
              <button
                @click=${() => {
                  this.setFlag(country.code);
                  this.close();
                }}
                class="text-center cursor-pointer border-none bg-none opacity-70 
                  w-[calc(100%/2-15px)] sm:w-[calc(100%/4-15px)] 
                  md:w-[calc(100%/6-15px)] lg:w-[calc(100%/8-15px)] 
                  xl:w-[calc(100%/10-15px)] min-w-[80px]"
              >
                <img
                  class="country-flag w-full h-auto"
                  src="/flags/${country.code}.svg"
                  @error=${(e: Event) => {
                    const img = e.currentTarget as HTMLImageElement;
                    const fallback = "/flags/xx.svg";
                    if (img.src && !img.src.endsWith(fallback)) {
                      img.src = fallback;
                    }
                  }}
                />
                <span class="country-name">${getTranslatedCountryName(country.code, country.name)}</span>
              </button>
            `,
          ) : html``}
        </div>
      </o-modal>
    `;
  }

  private includedInSearch(country: { name: string; code: string }): boolean {
    const q = this.search.toLowerCase();
    const localized = getTranslatedCountryName(country.code, country.name).toLowerCase();
    return (
      country.name.toLowerCase().includes(q) ||
      country.code.toLowerCase().includes(q) ||
      localized.includes(q)
    );
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  private setFlag(flag: string) {
    localStorage.setItem("flag", flag);
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  public open() {
    this.isModalOpen = true;
    this.modalEl?.open();
  }
  public close() {
    this.isModalOpen = false;
    this.modalEl?.close();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };
}
