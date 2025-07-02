import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import Countries from "../data/countries.json";
const flagKey: string = "flag";

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
    this.flag = flag;
    this.showModal = false;
    this.storeFlag(flag);
  }

  public getCurrentFlag(): string {
    return this.flag;
  }

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
          class="background-panel relative h-full px-3 py-4 flex items-center justify-center min-w-[52px] transition-base duration-200 group "
          title="Pick a flag!"
        >
          <o-icon
            src="icons/flag.svg"
            size="medium"
            color="var(--text-color-white)"
          ></o-icon>
        </button>
        <div class="absolute top-1 right-1 w-5 h-3 h-auto shadow-lg">
          <img src="/flags/${this.flag || "xxx"}.svg" />
        </div>
        ${this.showModal
          ? html`
              <div
                class="background-panel text-white flex flex-col gap-[0.5rem] absolute top-[60px] left-[0px] w-[780%] h-[500px] max-h-[50vh] max-w-[87vw]  z-50 ${this
                  .showModal
                  ? ""
                  : "hidden"}"
              >
                <div class="absolute left-3 text-textGrey w-[18px] h-[18px]">
                  <o-icon
                    src="icons/search.svg"
                    size="medium"
                    color="var(--text-color-grey)"
                  ></o-icon>
                </div>
                <input
                  class="w-full p-2 pl-10 bg-backgroundGrey border border-borderBase text-white font-['Pixel'] text-sm outline-none transition-colors duration-200 placeholder:text-gray-400/60 focus:border-blue-600"
                  type="text"
                  placeholder="Search..."
                  @change=${this.handleSearch}
                  @keyup=${this.handleSearch}
                />
                <div
                  class="flex flex-wrap justify-evenly gap-[1rem] overflow-y-auto overflow-x-hidden"
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
                        id="flag-selection-button"
                        @click=${() => this.setFlag(country.code)}
                        class="text-center cursor-pointer border-none bg-none opacity-70 sm:w-[calc(33.3333%-15px) w-[calc(100%/3-15px)] md:w-[calc(100%/4-15px)]"
                      >
                        <img
                          class="country-flag w-full h-auto"
                          src="/flags/${country.code}.svg"
                        />
                        <span class="country-name">${country.name}</span>
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
