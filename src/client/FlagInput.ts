import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderPlayerFlag } from "../core/CustomFlag";
import { FlagSchema } from "../core/Schemas";
import { translateText } from "./Utils";

const flagKey: string = "flag";

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() public flag: string = "";

  static styles = css`
    :host {
      display: block;
    }
    .flag-btn {
      width: 100%;
      height: 100%;
    }
    @media (max-width: 768px) {
      .flag-modal {
        width: 80vw;
      }

      .dropdown-item {
        width: calc(100% / 3 - 15px);
      }
    }
  `;

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
        class="flag-btn p-0 m-0 border-0 bg-transparent hover:bg-transparent rounded-none flex cursor-pointer justify-center items-center focus:outline-none focus:ring-0"
        title=${translateText("flag_input.button_title")}
      >
        <span
          id="flag-preview"
          style="display:inline-block; vertical-align:middle; overflow:hidden; width: 52px; height: 52px;"
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
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.onerror = () => {
        if (!img.src.endsWith("/flags/xx.svg")) {
          img.src = "/flags/xx.svg";
        }
      };
      preview.appendChild(img);
    }
  }
}
