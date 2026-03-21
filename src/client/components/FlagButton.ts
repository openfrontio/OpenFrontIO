import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Product } from "../../core/CosmeticSchemas";
import { translateText } from "../Utils";
import "./PurchaseButton";

export interface FlagItem {
  key: string;
  name: string;
  url: string;
  product?: Product | null;
}

@customElement("flag-button")
export class FlagButton extends LitElement {
  @property({ type: Boolean })
  selected: boolean = false;

  @property({ type: Object })
  flag!: FlagItem;

  @property({ type: Boolean })
  requiresPurchase: boolean = false;

  @property({ type: Function })
  onSelect?: (flagKey: string) => void;

  @property({ type: Function })
  onPurchase?: () => void;

  createRenderRoot() {
    return this;
  }

  private translateCosmetic(prefix: string, name: string): string {
    const translation = translateText(`${prefix}.${name}`);
    if (translation.startsWith(prefix)) {
      return name
        .split("_")
        .filter((word) => word.length > 0)
        .map((word) => word[0].toUpperCase() + word.substring(1))
        .join(" ");
    }
    return translation;
  }

  private handleClick() {
    this.onSelect?.(this.flag.key);
  }

  render() {
    return html`
      <div
        class="flex flex-col items-center justify-between gap-2 p-3 bg-white/5 backdrop-blur-sm border rounded-xl w-48 h-full transition-all duration-200 ${this
          .selected
          ? "border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]"
          : "hover:bg-white/10 hover:border-white/20 hover:shadow-xl border-white/10"}"
      >
        <button
          class="group relative flex flex-col items-center w-full gap-2 rounded-lg cursor-pointer transition-all duration-200
                 disabled:cursor-not-allowed flex-1"
          ?disabled=${this.requiresPurchase}
          @click=${this.handleClick}
        >
          <div class="flex flex-col items-center w-full">
            <div
              class="text-xs font-bold text-white uppercase tracking-wider mb-1 text-center truncate w-full ${this
                .requiresPurchase
                ? "opacity-50"
                : ""}"
              title="${this.translateCosmetic("flags", this.flag.name)}"
            >
              ${this.translateCosmetic("flags", this.flag.name)}
            </div>
            <div class="h-[22px] mb-2 w-full"></div>
          </div>

          <div
            class="w-full aspect-square flex items-center justify-center bg-white/5 rounded-lg p-2 border border-white/10 group-hover:border-white/20 transition-colors duration-200 overflow-hidden"
          >
            <img
              src=${this.flag.url}
              alt=${this.flag.name}
              class="w-full h-full object-contain pointer-events-none"
              draggable="false"
              loading="lazy"
              @error=${(e: Event) => {
                const img = e.currentTarget as HTMLImageElement;
                const fallback = "/flags/xx.svg";
                if (img.src && !img.src.endsWith(fallback)) {
                  img.src = fallback;
                }
              }}
            />
          </div>
        </button>

        ${this.requiresPurchase && this.flag.product
          ? html`
              <purchase-button
                .product=${this.flag.product}
                .onPurchase=${() => this.onPurchase?.()}
              ></purchase-button>
            `
          : null}
      </div>
    `;
  }
}
