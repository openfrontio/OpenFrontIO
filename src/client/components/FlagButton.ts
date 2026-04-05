import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Flag } from "../../core/CosmeticSchemas";
import { translateCosmetic } from "../Cosmetics";
import "./CosmeticContainer";
import "./CosmeticInfo";

export type FlagItem = Flag & { key: string };

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
    if (this.requiresPurchase) {
      this.onPurchase?.();
      return;
    }
    this.onSelect?.(this.flag.key);
  }

  render() {
    return html`
      <cosmetic-container
        class="flex flex-col items-center justify-between gap-1 p-1.5 w-36 h-full"
        .rarity=${this.flag.rarity ?? "common"}
        .selected=${this.selected}
        .product=${this.requiresPurchase && this.flag.product
          ? this.flag.product
          : null}
        .onPurchase=${() => this.onPurchase?.()}
        .name=${translateCosmetic("flags", this.flag.name)}
      >
        <button
          class="group relative flex flex-col items-center w-full gap-1 rounded-lg cursor-pointer transition-all duration-200 flex-1"
          @click=${this.handleClick}
        >
          <cosmetic-info
            .artist=${this.flag.artist}
            .rarity=${this.flag.rarity}
          ></cosmetic-info>

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
      </cosmetic-container>
    `;
  }
}
