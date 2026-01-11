import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderPlayerFlag } from "../core/CustomFlag";
import { FlagSchema } from "../core/Schemas";
import { translateText } from "./Utils";

const flagKey: string = "flag";

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() public flag: string = "";

  static styles = css``;

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
    if (!FlagSchema.safeParse(e.detail.flag).success) return;
    if (this.flag !== e.detail.flag) {
      this.flag = e.detail.flag;
    }
  };

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
    return html`
      <button
        id="flag-input_"
        class="flag-btn m-0 border-0 bg-transparent hover:bg-white/10 w-full h-full flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0 transition-colors duration-200"
        style="padding: 0 !important;"
        title=${translateText("flag_input.button_title")}
      >
        <span
          id="flag-preview"
          class="w-full h-full overflow-hidden"
          style="display:block;"
        ></span>
      </button>
    `;
  }

  updated() {
    const preview = this.renderRoot.querySelector(
      "#flag-preview",
    ) as HTMLElement;
    if (!preview) return;

    preview.innerHTML = "";

    if (this.flag?.startsWith("!")) {
      renderPlayerFlag(this.flag, preview);
    } else {
      const img = document.createElement("img");
      img.src = this.flag ? `/flags/${this.flag}.svg` : `/flags/xx.svg`;
      img.className = "w-full h-full object-cover drop-shadow";
      img.onerror = () => {
        if (!img.src.endsWith("/flags/xx.svg")) {
          img.src = "/flags/xx.svg";
        }
      };
      preview.appendChild(img);
    }
  }
}
