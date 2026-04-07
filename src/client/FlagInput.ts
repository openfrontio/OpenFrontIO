import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { FlagName } from "../core/Schemas";
import {
  FLAG_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../core/game/UserSettings";
import { resolveFlagUrl } from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() public flag: string = "";

  @property({ type: Boolean, attribute: "show-select-label" })
  public showSelectLabel: boolean = false;

  private isDefaultFlagValue(flag: string): boolean {
    return !flag || flag === "xx" || flag === "country:xx";
  }

  private updateFlag = (e: CustomEvent) => {
    const parsed = FlagName.safeParse(e.detail);
    if (!parsed.success) {
      console.warn(`error parsing flag ${e.detail.value}, ${parsed.error}`);
    }
    if (this.flag !== e.detail) {
      this.flag = e.detail;
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
    this.flag = new UserSettings().getFlag() ?? "";
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${FLAG_KEY}`,
      this.updateFlag as EventListener,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${FLAG_KEY}`,
      this.updateFlag as EventListener,
    );
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
              class="text-[7px] lg:text-[10px] font-black tracking-wider text-white uppercase leading-tight lg:leading-none w-full text-center px-0.5 lg:px-1"
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

    if (this.isDefaultFlagValue(this.flag)) {
      preview.innerHTML = "";
      return;
    }

    preview.innerHTML = "";

    const url = await resolveFlagUrl(this.flag);
    if (!url) return;

    const img = document.createElement("img");
    img.src = url;
    img.className = "w-full h-full object-cover pointer-events-none";
    img.draggable = false;
    preview.appendChild(img);
  }
}
