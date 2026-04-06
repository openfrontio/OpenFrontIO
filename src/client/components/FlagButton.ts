import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Product } from "../../core/CosmeticSchemas";
import { translateCosmetic } from "../Cosmetics";
import "./ArtistInfo";
import "./PurchaseButton";

export interface FlagItem {
  key: string;
  name: string;
  url: string;
  product?: Product | null;
  artist?: string;
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

  private handleClick() {
    this.onSelect?.(this.flag.key);
  }

  render() {
    return html`
      <div
        class="flex flex-col items-center justify-between gap-1 p-1.5 bg-white/5 backdrop-blur-sm border rounded-lg w-36 h-full transition-all duration-200 ${this
          .selected
          ? "border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]"
          : "hover:bg-white/10 hover:border-white/20 hover:shadow-xl border-white/10"}"
      >
        <button
          class="group relative flex flex-col items-center w-full gap-1 rounded-lg cursor-pointer transition-all duration-200
                 disabled:cursor-not-allowed flex-1"
          ?disabled=${this.requiresPurchase}
          @click=${this.handleClick}
        >
          <artist-info .artist=${this.flag.artist}></artist-info>
          <div
            class="text-[10px] font-bold text-white uppercase tracking-wider mt-1 ${this
              .flag.artist
              ? "pr-5"
              : ""} text-center truncate w-full ${this.requiresPurchase
              ? "opacity-50"
              : ""}"
            title="${translateCosmetic("flags", this.flag.name)}"
          >
            ${translateCosmetic("flags", this.flag.name)}
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
