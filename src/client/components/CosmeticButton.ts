import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Flag, Pack, Pattern } from "../../core/CosmeticSchemas";
import { PlayerPattern } from "../../core/Schemas";
import {
  PaymentMethod,
  ResolvedCosmetic,
  translateCosmetic,
} from "../Cosmetics";
import { translateText } from "../Utils";
import "./CapIcon";
import "./CosmeticContainer";
import "./CosmeticInfo";
import { renderPatternPreview } from "./PatternPreview";
import "./PlutoniumIcon";

@customElement("cosmetic-button")
export class CosmeticButton extends LitElement {
  @property({ type: Object })
  resolved!: ResolvedCosmetic;

  @property({ type: Boolean })
  selected: boolean = false;

  @property({ type: Function })
  onSelect?: (resolved: ResolvedCosmetic) => void;

  @property({ type: Function })
  onPurchase?: (resolved: ResolvedCosmetic, method: PaymentMethod) => void;

  createRenderRoot() {
    return this;
  }

  private handleClick() {
    this.onSelect?.(this.resolved);
  }

  private get displayName(): string {
    const c = this.resolved.cosmetic;
    if (c === null) {
      return translateText("territory_patterns.pattern.default");
    }
    if (this.resolved.type === "pattern") {
      return translateCosmetic("territory_patterns.pattern", c.name);
    }
    if (this.resolved.type === "pack") {
      return (c as Pack).displayName;
    }
    return translateCosmetic("flags", c.name);
  }

  private renderPreview(): TemplateResult {
    if (this.resolved.type === "pattern") {
      const c = this.resolved.cosmetic;
      const playerPattern: PlayerPattern | null =
        c === null
          ? null
          : {
              name: c.name,
              patternData: (c as Pattern).pattern,
              colorPalette: this.resolved.colorPalette ?? undefined,
            };
      return renderPatternPreview(playerPattern, 150, 150);
    }

    if (this.resolved.type === "pack") {
      const pack = this.resolved.cosmetic as Pack;
      const isHard = pack.currency === "hard";
      const icon = isHard
        ? html`<plutonium-icon
            class="flex-1 flex items-center"
            .size=${100}
          ></plutonium-icon>`
        : html`<cap-icon
            class="flex-1 flex items-center"
            .size=${100}
          ></cap-icon>`;
      const colorClass = isHard ? "text-green-400" : "text-amber-700";
      const currencyKey = isHard ? "cosmetics.hard" : "cosmetics.soft";
      return html`<div
        class="flex flex-col items-center justify-end h-full w-full text-center gap-1 pb-1"
      >
        ${icon}
        <span class="text-lg font-black ${colorClass}"
          >${pack.amount.toLocaleString()}</span
        >
        <span class="text-[10px] font-bold text-white/50 uppercase"
          >${translateText(currencyKey)}</span
        >
      </div>`;
    }

    const c = this.resolved.cosmetic as Flag;
    return html`<img
      src=${c.url}
      alt=${c.name}
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
    />`;
  }

  render() {
    const c = this.resolved.cosmetic;
    const isPurchasable = this.resolved.relationship === "purchasable";
    const type = this.resolved.type;
    const isPattern = type === "pattern";
    const sizeClass = type === "flag" ? "gap-1 p-1.5 w-36" : "gap-2 p-3 w-48";
    const crazygamesClass = isPattern ? "no-crazygames " : "";

    return html`
      <cosmetic-container
        class="${crazygamesClass}flex flex-col items-center justify-between ${sizeClass} h-full"
        .rarity=${c?.rarity ?? "common"}
        .selected=${this.selected}
        .product=${isPurchasable && c?.product ? c.product : null}
        .priceHard=${isPurchasable ? (c?.priceHard ?? null) : null}
        .priceSoft=${isPurchasable ? (c?.priceSoft ?? null) : null}
        .onPurchaseDollar=${isPurchasable && c?.product
          ? () => this.onPurchase?.(this.resolved, "dollar")
          : undefined}
        .onPurchaseHard=${isPurchasable && c?.priceHard !== undefined
          ? () => this.onPurchase?.(this.resolved, "hard")
          : undefined}
        .onPurchaseSoft=${isPurchasable && c?.priceSoft !== undefined
          ? () => this.onPurchase?.(this.resolved, "soft")
          : undefined}
        .name=${this.displayName}
      >
        <button
          class="group relative flex flex-col items-center w-full ${isPattern
            ? "gap-2"
            : "gap-1"} rounded-lg cursor-pointer transition-all duration-200 flex-1"
          @click=${() => this.handleClick()}
        >
          ${(c?.product ?? c?.priceHard ?? c?.priceSoft)
            ? html`<cosmetic-info
                .artist=${c.artist}
                .rarity=${c.rarity}
                .colorPalette=${this.resolved.colorPalette?.name}
                .showAdFree=${isPurchasable}
              ></cosmetic-info>`
            : nothing}

          <div
            class="w-full aspect-square flex items-center justify-center bg-white/5 rounded-lg p-2 border border-white/10 group-hover:border-white/20 transition-colors duration-200 overflow-hidden"
          >
            ${this.renderPreview()}
          </div>
        </button>
      </cosmetic-container>
    `;
  }
}
