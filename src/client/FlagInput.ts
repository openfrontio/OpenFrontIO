import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { FlagName } from "../core/Schemas";
import { resolveFlagUrl } from "./Cosmetics";
import { translateText } from "./Utils";

const flagKey: string = "flag";

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() public flag: string = "";

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  private isDefaultFlagValue(flag: string): boolean {
    return !flag || flag === "xx";
  }

  private getStoredFlag(): string {
    let storedFlag = localStorage.getItem(flagKey);
    if (!storedFlag) return "";
    // Migrate bare country codes to country: prefix
    if (!storedFlag.startsWith("flag:") && !storedFlag.startsWith("country:")) {
      storedFlag = `country:${storedFlag}`;
      localStorage.setItem(flagKey, storedFlag);
    }
    return storedFlag;
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

  private updateFlag = (ev: Event) => {
    const e = ev as CustomEvent<{ flag: string }>;
    if (!FlagName.safeParse(e.detail.flag).success) return;
    if (this.flag !== e.detail.flag) {
      this.flag = e.detail.flag;
    }
  };

  private onInputClick(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("flag-input-click", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  connectedCallback() {
    super.connectedCallback();
    this.flag = this.getStoredFlag();
    this.dispatchFlagEvent();
    window.addEventListener("flag-change", this.updateFlag as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("flag-change", this.updateFlag as EventListener);
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const isDefaultFlag = this.isDefaultFlagValue(this.flag);
    const showSelect = this.showSelectLabel && isDefaultFlag;
    const buttonTitle = showSelect
      ? translateText("flag_input.title")
      : translateText("flag_input.button_title");

    return html`
      <button
        id="flag-input"
        class="flag-btn p-0 m-0 border-0 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-all duration-200 hover:scale-105 bg-[color-mix(in_oklab,var(--frenchBlue)_75%,black)] hover:brightness-[1.08] active:brightness-[0.95] rounded-lg overflow-hidden"
        title=${buttonTitle}
        @click=${this.onInputClick}
      >
        <span
          id="flag-preview"
          class=${showSelect ? "hidden" : "w-full h-full overflow-hidden"}
        ></span>
        ${showSelect
          ? html`<span
              class="text-[10px] font-medium tracking-wider text-white uppercase leading-none break-words w-full text-center px-1"
            >
              ${translateText("flag_input.title")}
            </span>`
          : null}
      </button>
    `;
  }

  async updated() {
    const preview = this.renderRoot.querySelector(
      "#flag-preview",
    ) as HTMLElement;
    if (!preview) return;

    if (this.showSelectLabel && this.isDefaultFlagValue(this.flag)) {
      preview.innerHTML = "";
      return;
    }

    preview.innerHTML = "";

    const img = document.createElement("img");
    img.src = this.flag
      ? ((await resolveFlagUrl(this.flag)) ?? "/flags/xx.svg")
      : "/flags/xx.svg";
    img.className = "w-full h-full object-cover pointer-events-none";
    img.draggable = false;
    img.onerror = () => {
      if (!img.src.endsWith("/flags/xx.svg")) {
        img.src = "/flags/xx.svg";
      }
    };
    preview.appendChild(img);
  }
}
