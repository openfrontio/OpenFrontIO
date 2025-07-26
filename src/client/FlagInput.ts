import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "./data/countries.json";

const LOCAL_STORAGE_KEY: string = "flag";

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() private selectedFlag: string = "";
  @state() private searchQuery: string = "";
  @state() private showModal: boolean = false;

  private handleSearch(e: Event) {
    this.searchQuery = String((e.target as HTMLInputElement).value);
  }

  private setSelectedFlag(flag: string) {
    if (flag === "xx") {
      flag = "";
    }
    this.selectedFlag = flag;
    this.storeSelectedFlag(flag);
  }

  public getCurrentFlag(): string {
    return this.selectedFlag;
  }

  private getStoredSelectedFlag(): string {
    const storedFlag = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedFlag) {
      return storedFlag;
    }
    return "";
  }

  private storeSelectedFlag(flag: string) {
    if (flag) {
      localStorage.setItem(LOCAL_STORAGE_KEY, flag);
    } else if (flag === "") {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }

  private dispatchFlagEvent() {
    this.dispatchEvent(
      new CustomEvent("flag-change", {
        detail: { flag: this.selectedFlag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  connectedCallback() {
    super.connectedCallback();
    this.selectedFlag = this.getStoredSelectedFlag();
    this.dispatchFlagEvent();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="absolute left-0 top-0 w-full h-full ${this.showModal
          ? ""
          : "hidden"}"
        @click=${() => (this.showModal = false)}
      ></div>
      <div class="flex relative">
        <button
          @click=${() => (this.showModal = !this.showModal)}
          class="border p-[4px] rounded-lg flex cursor-pointer border-black/30 dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)]"
          title="Pick a flag!"
        >
          <img
            class="size-[48px]"
            src="/flags/${this.selectedFlag || "xx"}.svg"
          />
        </button>
        ${this.showModal
          ? html`
              <div
                class="text-white flex flex-col absolute shadow-2xl p-2.5 top-[61px] left-0 w-[825%] h-[500px] max-h-[50vh] max-w-[87vw] bg-white/75 dark:bg-gray-900/70 backdrop-blur-md rounded-[8px] z-[3] ${this
                  .showModal
                  ? ""
                  : "hidden"}"
              >
                <div class="pb-2.5">
                  <label for="flagSearchInput" class="sr-only"
                    >Search flags</label
                  >
                  <div
                    class="group/search relative text-gray-950 dark:text-gray-50"
                  >
                    <input
                      id="flagSearchInput"
                      class="peer w-full font-light transition-all duration-300 tracking-wide h-9 ps-10 pr-1 pb-0.5 pt-px rounded-md shadow-sm text-xl outline-none border border-gray-300 dark:border-gray-300/60 focus-visible:!border-blue-500 focus-visible:ring-blue-500/60 focus-visible:ring-2 bg-gray-50 dark:bg-gray-700 placeholder-inherit placeholder:opacity-80 dark:placeholder:opacity-70 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none"
                      type="search"
                      placeholder="Search flags..."
                      @change=${this.handleSearch}
                      @keyup=${this.handleSearch}
                    />
                    <div
                      class="absolute flex inset-y-[0.36rem] start-0 ps-2.5 pointer-events-none text-inherit peer-focus-visible:!opacity-95 dark:peer-placeholder-shown:opacity-70 peer-placeholder-shown:opacity-80 transition-all"
                    >
                      <svg
                        class="search-icon size-6 shrink-0"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="m21 21-4.34-4.34" />
                        <circle cx="11" cy="11" r="8" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div
                  class="grid grid-cols-3 gap-3 overflow-y-auto overflow-x-hidden p-px pt-0.5"
                >
                  ${Countries.filter(
                    (country) =>
                      country.name
                        .toLowerCase()
                        .includes(this.searchQuery.toLowerCase()) ||
                      country.code
                        .toLowerCase()
                        .includes(this.searchQuery.toLowerCase()),
                  ).map((country) => {
                    const isSelected = this.selectedFlag === country.code;
                    return html`
                      <button
                        @click=${isSelected
                          ? () => {} // no-op if already selected
                          : () => this.setSelectedFlag(country.code)}
                        class="group/flag flex flex-col space-y-1.5 md:space-y-1 text-center px-px pt-1.5 md:pt-1 pb-1.5 border-2 rounded-lg transition-all duration-200 ease-in-out will-change-transform hover:scale-[1.01]
                        ${isSelected
                          ? `bg-blue-300/50 border-blue-500/75 hover:bg-blue-200 hover:border-blue-400
                          dark:bg-blue-800/70 dark:border-blue-500/75 dark:hover:bg-blue-600/50 dark:hover:border-blue-400/75
                          cursor-default scale-[1.01]`
                          : `bg-gray-300/80 border-gray-400/75 hover:bg-gray-200 hover:border-gray-400
                          dark:bg-gray-700 dark:border-gray-500/50 dark:hover:bg-gray-700/60 dark:hover:border-gray-400/75`}"
                      >
                        <div>
                          <img
                            class="w-full h-16 object-cover object-center"
                            alt="${country.name} flag"
                            src="/flags/${country.code}.svg"
                          />
                        </div>

                        <div
                          class="flex-1 flex flex-col items-center justify-center text-black dark:!text-gray-100 rounded-md mx-[0.3rem] md:mx-[0.33rem] py-1 px-0.5 transition-all duration-300 ease-in-out
                          ${isSelected
                            ? "bg-blue-400/70 group-hover/flag:bg-blue-400/55 dark:bg-blue-400/40 dark:group-hover/flag:bg-blue-400/55"
                            : "bg-gray-400/70 group-hover/flag:bg-gray-400/60 group-hover/flag:text-gray-900 dark:bg-gray-500/50 dark:group-hover/flag:bg-gray-400/45"}"
                        >
                          <p class="leading-snug font-medium text-[0.78rem]">
                            ${country.name}
                          </p>
                        </div>
                      </button>
                    `;
                  })}
                </div>
              </div>
            `
          : ""}
      </div>
    `;
  }
}
