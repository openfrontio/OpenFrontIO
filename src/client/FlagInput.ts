import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { renderPlayerFlag } from "../core/CustomFlag";
import { FlagSchema } from "../core/Schemas";

const flagKey = "flag";

@customElement("flag-input")
export class FlagInput extends LitElement {
  @state() public flag = "";

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
        bubbles: true,
        composed: true,
        detail: { flag: this.flag },
      }),
    );
  }

  private readonly updateFlag = (ev: Event) => {
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
      <div class="flex relative">
        <button
          id="flag-input_"
          class="border p-[4px] rounded-lg flex cursor-pointer border-black/30
          dark:border-gray-300/60 bg-white/70 dark:bg-[rgba(55,65,81,0.7)]"
          title="Pick a flag!"
        >
          <span
            id="flag-preview"
            style="display:inline-block; width:48px; height:64px;
            vertical-align:middle; background:#333; border-radius:6px;
            overflow:hidden;"
          ></span>
        </button>
      </div>
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
      img.src = this.flag ? `/flags/${this.flag}.svg` : "/flags/xx.svg";
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
