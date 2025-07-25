import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "./data/countries.json";

const LOCAL_STORAGE_KEY: string = "flag";

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() private flag: string = "";
  @state() private search: string = "";
  @state() private showModal: boolean = false;

  static styles = css`
    @media (max-width: 768px) {
      .flag-modal {
        width: 80vw;
      }

      .dropdown-item {
        width: calc(100% / 3 - 15px);
      }
    }
  `;

  private handleSearch(e: Event) {
    this.search = String((e.target as HTMLInputElement).value);
  }

  private setFlag(flag: string) {
    if (flag === "xx") {
      flag = "";
    }
    this.flag = flag;
    this.showModal = false;
    this.storeFlag(flag);
  }

  public getCurrentFlag(): string {
    return this.flag;
  }

  private getStoredFlag(): string {
    const storedFlag = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedFlag) {
      return storedFlag;
    }
    return "";
  }

  private storeFlag(flag: string) {
    if (flag) {
      localStorage.setItem(LOCAL_STORAGE_KEY, flag);
    } else if (flag === "") {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
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

  connectedCallback() {
    super.connectedCallback();
    this.flag = this.getStoredFlag();
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
          <img class="size-[48px]" src="/flags/${this.flag || "xx"}.svg" />
        </button>
        ${this.showModal
          ? html`
              <div
                class="text-white flex flex-col gap-[0.8rem] absolute top-[61px] left-[0px] w-[825%] h-[500px] max-h-[50vh] max-w-[87vw] bg-gray-900/80 backdrop-blur-md p-[10px] rounded-[8px] z-[3] ${this
                  .showModal
                  ? ""
                  : "hidden"}"
              >
                <div class="group/search relative text-black _dark:text-white">
                  <div
                    class="pointer-events-none absolute size-7 inset-y-1 start-0 ps-2 peer-disabled:opacity-50"
                  >
                    <svg
                      class="search-icon shrink-0"
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
                  <input
                    id="flagSearchInput"
                    class="transition-[color,box-shadow] peer ps-10 pr-1 pb-[0.15rem] pt-0.5 w-full h-8 rounded-md border shadow-sm text-lg outline-none focus-visible:ring-1 focus-visible:border-blue-500 focus-visible:ring-blue-500"
                    blablablabla="TODO REMOVE ps-10 dark:border-gray-300/60 dark:bg-gray-700"
                    type="search"
                    placeholder="Search flags..."
                    @change=${this.handleSearch}
                    @keyup=${this.handleSearch}
                  />
                </div>
                <div
                  class="grid grid-cols-3 gap-x-3.5 gap-3.5 overflow-y-auto overflow-x-hidden pt-px"
                >
                  ${Countries.filter(
                    (country) =>
                      country.name
                        .toLowerCase()
                        .includes(this.search.toLowerCase()) ||
                      country.code
                        .toLowerCase()
                        .includes(this.search.toLowerCase()),
                  ).map(
                    (country) => html`
                      <button
                        class="group/flag flex flex-col text-center px-px pt-0.5 pb-2 space-y-0.5 rounded-lg border-2 cursor-pointer transition-all duration-200 ease-in-out will-change-transform hover:-translate-y-px bg-gray-500/25 border-gray-500/60 hover:bg-gray-400/35 hover:border-gray-400"
                        title="${country.name}"
                        @click=${() => this.setFlag(country.code)}
                      >
                        <img
                          class="w-full h-[4.5rem] object-cover object-center"
                          alt="${country.name} flag"
                          src="/flags/${country.code}.svg"
                        />
                        <div
                          class="flex flex-col bg-blue-300/20 text-gray-100 group-hover/flag:bg-blue-300/40 items-center justify-center flex-1 rounded-md mx-[0.34rem] py-1 px-1.5"
                        >
                          <p class="leading-snug text-[0.8rem]">
                            ${country.name}
                          </p>
                        </div>
                      </button>
                    `,
                  )}
                </div>
              </div>
            `
          : ""}
      </div>
    `;
  }
}
