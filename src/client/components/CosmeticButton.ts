import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  Flag,
  Pack,
  Pattern,
  Skin,
  Subscription,
} from "../../core/CosmeticSchemas";
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
import { DEFAULT_DOLLAR_LABEL_KEY } from "./PurchaseButton";

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

  /** True if the user already has a subscription (any tier). */
  @property({ type: Boolean })
  userHasSubscription: boolean = false;

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
    if (this.resolved.type === "pattern" || this.resolved.type === "skin") {
      return translateCosmetic("territory_patterns.pattern", c.name);
    }
    if (this.resolved.type === "pack") {
      return (c as Pack).displayName;
    }
    if (this.resolved.type === "subscription") {
      return translateCosmetic("subscriptions", c.name);
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

    if (this.resolved.type === "skin") {
      const c = this.resolved.cosmetic as Skin | null;
      if (c === null) {
        // "Default" tile — visually consistent with pattern's default tile.
        return html`<div
          class="w-full h-full flex items-center justify-center text-white/40 text-xs uppercase"
        >
          ${translateText("territory_patterns.pattern.default")}
        </div>`;
      }
      return html`<img
        src=${c.url}
        alt=${c.name}
        class="w-full h-full object-contain pointer-events-none"
        draggable="false"
        loading="lazy"
      />`;
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
        class="relative flex flex-col items-center justify-end h-full w-full text-center gap-1 pb-1"
      >
        ${icon}
        <span class="text-lg font-black ${colorClass}"
          >${pack.amount.toLocaleString()}</span
        >
        <span class="text-[10px] font-bold text-white/50 uppercase"
          >${translateText(currencyKey)}</span
        >
        ${pack.bonusAmount > 0
          ? html`<div
              class="absolute top-3 -right-8 bg-green-500 text-white text-[10px] font-black px-8 py-0.5 rotate-45 shadow-md uppercase tracking-wide pointer-events-none"
            >
              ${translateText("cosmetics.free", {
                numFree: pack.bonusAmount.toLocaleString(),
              })}
            </div>`
          : nothing}
      </div>`;
    }

    if (this.resolved.type === "subscription") {
      const sub = this.resolved.cosmetic as Subscription;
      return html`<div
        class="flex flex-col items-center justify-between h-full w-full text-center gap-2 p-1"
      >
        <span class="text-xs text-white/70 line-clamp-3 px-1"
          >${sub.description}</span
        >
        <div class="flex flex-col items-center gap-1">
          <div class="flex items-center gap-1.5">
            <plutonium-icon .size=${24}></plutonium-icon>
            <span class="text-sm font-bold text-green-400"
              >${sub.dailyHardCurrency.toLocaleString()}</span
            >
            <span class="text-[10px] text-white/50 uppercase"
              >${translateText("cosmetics.per_day")}</span
            >
          </div>
          <div class="flex items-center gap-1.5">
            <cap-icon .size=${24}></cap-icon>
            <span class="text-sm font-bold text-amber-700"
              >${sub.dailySoftCurrency.toLocaleString()}</span
            >
            <span class="text-[10px] text-white/50 uppercase"
              >${translateText("cosmetics.per_day")}</span
            >
          </div>
        </div>
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
    const priced = c as Pattern | Skin | Flag | Pack | null;
    const priceHard = priced?.priceHard;
    const priceSoft = priced?.priceSoft;
    const artist = priced?.artist;
    const isPurchasable = this.resolved.relationship === "purchasable";
    const type = this.resolved.type;
    const isPattern = type === "pattern";
    const isSkin = type === "skin";
    const isOwnedSubscription =
      type === "subscription" && this.resolved.relationship === "owned";
    const dollarLabelKey =
      type === "subscription"
        ? this.userHasSubscription
          ? "store.switch_button"
          : "store.subscribe_button"
        : DEFAULT_DOLLAR_LABEL_KEY;
    const priceSuffix =
      type === "subscription" ? translateText("store.price_per_month") : "";
    const sizeClass = type === "flag" ? "gap-1 p-1.5 w-36" : "gap-2 p-3 w-48";
    const crazygamesClass = isPattern || isSkin ? "no-crazygames " : "";

    return html`
      <cosmetic-container
        class="${crazygamesClass}flex flex-col items-center justify-between ${sizeClass} h-full"
        .rarity=${c?.rarity ?? "common"}
        .selected=${this.selected}
        .product=${isPurchasable && c?.product ? c.product : null}
        .priceHard=${isPurchasable ? (priceHard ?? null) : null}
        .priceSoft=${isPurchasable ? (priceSoft ?? null) : null}
        .dollarLabelKey=${dollarLabelKey}
        .priceSuffix=${priceSuffix}
        .onPurchaseDollar=${isPurchasable && c?.product
          ? () => this.onPurchase?.(this.resolved, "dollar")
          : undefined}
        .onPurchaseHard=${isPurchasable && priceHard !== undefined
          ? () => this.onPurchase?.(this.resolved, "hard")
          : undefined}
        .onPurchaseSoft=${isPurchasable && priceSoft !== undefined
          ? () => this.onPurchase?.(this.resolved, "soft")
          : undefined}
        .name=${this.displayName}
      >
        <button
          class="group relative flex flex-col items-center w-full ${isPattern ||
          isSkin
            ? "gap-2"
            : "gap-1"} rounded-lg cursor-pointer transition-all duration-200 flex-1"
          @click=${() => this.handleClick()}
        >
          ${(c?.product ?? priceHard ?? priceSoft)
            ? html`<cosmetic-info
                .artist=${artist}
                .rarity=${c!.rarity}
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
        ${isOwnedSubscription
          ? html`<div
              class="w-full mt-2 px-4 py-2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold uppercase tracking-wider text-center"
            >
              ${translateText("store.current_plan")}
            </div>`
          : nothing}
      </cosmetic-container>
    `;
  }
}
