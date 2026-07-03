import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Effect,
  Flag,
  isNukeExplosionEffect,
  Pack,
  Pattern,
  Skin,
  Subscription,
} from "../../core/CosmeticSchemas";
import { PlayerPattern } from "../../core/Schemas";
import {
  PaymentMethod,
  PurchaseResult,
  ResolvedCosmetic,
  translateCosmetic,
} from "../Cosmetics";
import { translateText } from "../Utils";
import "./CapIcon";
import "./CosmeticContainer";
import "./CosmeticInfo";
import "./EffectPreview"; // registers <trail-swatch>, <shockwave-swatch>, <sparkles-swatch>
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
  onPurchase?: (
    resolved: ResolvedCosmetic,
    method: PaymentMethod,
  ) => Promise<PurchaseResult>;

  /** True if the user already has a subscription (any tier). */
  @property({ type: Boolean })
  userHasSubscription: boolean = false;

  /** Colour variants of one pattern; 2+ become clickable swatches. */
  @property({ attribute: false })
  variants?: ResolvedCosmetic[];

  /** Key of the swatch the user has picked; null until they pick one. */
  @state() private activeVariantKey: string | null = null;

  /** The variant currently previewed/purchased: picked swatch, else fallback. */
  private get activeResolved(): ResolvedCosmetic {
    const variants = this.variants;
    if (variants && variants.length > 0) {
      return (
        variants.find((v) => v.key === this.activeVariantKey) ?? variants[0]
      );
    }
    return this.resolved;
  }

  createRenderRoot() {
    return this;
  }

  private handleClick() {
    this.onSelect?.(this.activeResolved);
  }

  private get displayName(): string {
    const c = this.activeResolved.cosmetic;
    if (c === null) {
      return translateText("territory_patterns.pattern.default");
    }
    if (
      this.activeResolved.type === "pattern" ||
      this.activeResolved.type === "skin"
    ) {
      return translateCosmetic("territory_patterns.pattern", c.name);
    }
    if (this.activeResolved.type === "pack") {
      return (c as Pack).displayName;
    }
    if (this.activeResolved.type === "subscription") {
      return translateCosmetic("subscriptions", c.name);
    }
    if (this.activeResolved.type === "effect") {
      return translateCosmetic("effects", c.name);
    }
    return translateCosmetic("flags", c.name);
  }

  /** True when the variants carry colour palettes to show as swatches. */
  private get hasColorRow(): boolean {
    return (
      this.variants !== undefined &&
      this.variants.some((v) => v.colorPalette !== null)
    );
  }

  /** Row of clickable split-circle colour swatches, one per palette. */
  private renderColorSwatches(): TemplateResult | typeof nothing {
    if (!this.hasColorRow) {
      return nothing;
    }
    const activeKey = this.activeResolved.key;
    return html`
      <div
        class="flex flex-wrap items-center justify-center gap-1.5 w-full px-1"
      >
        ${this.variants!.map((v) => {
          const primary = v.colorPalette?.primaryColor ?? "#ffffff";
          const secondary = v.colorPalette?.secondaryColor ?? "#000000";
          const isActive = v.key === activeKey;
          const label = v.colorPalette
            ? translateCosmetic(
                "territory_patterns.color_palette",
                v.colorPalette.name,
              )
            : "";
          const outline = isActive
            ? "0 0 0 2px rgba(255,255,255,0.95)"
            : "inset 0 0 0 1px rgba(255,255,255,0.2), 0 0 0 1px rgba(0,0,0,0.45)";
          return html`<button
            type="button"
            title=${label}
            aria-label=${label}
            aria-pressed=${isActive}
            class="w-5 h-5 shrink-0 rounded-full p-0 m-0 appearance-none cursor-pointer outline-none transition-transform duration-150 hover:scale-110 ${isActive
              ? "scale-110"
              : ""}"
            style="background-image: linear-gradient(135deg, ${primary} 0 calc(50% - 0.5px), rgba(255,255,255,0.55) calc(50% - 0.5px) calc(50% + 0.5px), ${secondary} calc(50% + 0.5px) 100%); box-shadow: ${outline};"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.activeVariantKey = v.key;
            }}
          ></button>`;
        })}
      </div>
    `;
  }

  private renderPreview(): TemplateResult {
    if (this.activeResolved.type === "pattern") {
      const c = this.activeResolved.cosmetic;
      const playerPattern: PlayerPattern | null =
        c === null
          ? null
          : {
              name: c.name,
              patternData: (c as Pattern).pattern,
              colorPalette: this.activeResolved.colorPalette ?? undefined,
            };
      return renderPatternPreview(playerPattern, 150, 150);
    }

    if (this.activeResolved.type === "skin") {
      const c = this.activeResolved.cosmetic as Skin | null;
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

    if (this.activeResolved.type === "effect") {
      const c = this.activeResolved.cosmetic as Effect | null;
      if (c === null) {
        // "Default" tile — selecting it clears the effect for that type.
        return html`<div
          class="w-full h-full flex items-center justify-center text-white/40 text-xs uppercase"
        >
          ${translateText("territory_patterns.pattern.default")}
        </div>`;
      }
      // Nuke explosions preview per visual type (expanding ring or sparkle
      // burst); every trail effectType (transportShipTrail, nukeTrail) and the
      // structures effect share the same attribute shapes and preview as a
      // color swatch.
      if (isNukeExplosionEffect(c)) {
        if (c.attributes.type === "sparkles") {
          return html`<sparkles-swatch
            class="block w-full h-full"
            .explosion=${c.attributes}
          ></sparkles-swatch>`;
        }
        return html`<shockwave-swatch
          class="block w-full h-full"
          .explosion=${c.attributes}
        ></shockwave-swatch>`;
      }
      return html`<trail-swatch
        class="block w-full h-full"
        .trail=${c.attributes}
      ></trail-swatch>`;
    }

    if (this.activeResolved.type === "pack") {
      const pack = this.activeResolved.cosmetic as Pack;
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

    if (this.activeResolved.type === "subscription") {
      const sub = this.activeResolved.cosmetic as Subscription;
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

    const c = this.activeResolved.cosmetic as Flag;
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
    const active = this.activeResolved;
    const c = active.cosmetic;
    const priced = c as Pattern | Skin | Flag | Effect | Pack | null;
    const priceHard = priced?.priceHard;
    const priceSoft = priced?.priceSoft;
    const artist = priced?.artist;
    const isPurchasable = active.relationship === "purchasable";
    const type = active.type;
    const isPattern = type === "pattern";
    const isSkin = type === "skin";
    const isOwnedSubscription =
      type === "subscription" && active.relationship === "owned";
    // Switching tiers shows "Switch"; a first-time subscribe shows price only.
    const dollarLabelKey =
      type === "subscription" && this.userHasSubscription
        ? "store.switch_button"
        : "";
    const priceSuffix =
      type === "subscription" ? translateText("store.price_per_month") : "";
    const sizeClass = type === "flag" ? "gap-1 p-1.5 w-36" : "gap-2 p-3 w-48";
    const crazygamesClass = isPattern || isSkin ? "no-crazygames " : "";
    // Colour-row tiles top-align so the skin box, swatches and price buttons
    // line up across the grid; other tiles fill height with justify-between.
    const hasColorRow = this.hasColorRow;

    return html`
      <cosmetic-container
        class="${crazygamesClass}flex flex-col items-center ${hasColorRow
          ? "justify-start"
          : "justify-between"} ${sizeClass} h-full"
        .rarity=${c?.rarity ?? "common"}
        .selected=${this.selected}
        .product=${isPurchasable && c?.product ? c.product : null}
        .priceHard=${isPurchasable ? (priceHard ?? null) : null}
        .priceSoft=${isPurchasable ? (priceSoft ?? null) : null}
        .dollarLabelKey=${dollarLabelKey}
        .priceSuffix=${priceSuffix}
        .onPurchaseDollar=${isPurchasable && c?.product
          ? async () => this.onPurchase?.(this.activeResolved, "dollar")
          : undefined}
        .onPurchaseHard=${isPurchasable && priceHard !== undefined
          ? async () => this.onPurchase?.(this.activeResolved, "hard")
          : undefined}
        .onPurchaseSoft=${isPurchasable && priceSoft !== undefined
          ? async () => this.onPurchase?.(this.activeResolved, "soft")
          : undefined}
        .name=${this.displayName}
      >
        <button
          class="group relative flex flex-col items-center w-full ${isPattern ||
          isSkin
            ? "gap-2"
            : "gap-1"} rounded-lg cursor-pointer transition-all duration-200 ${hasColorRow
            ? ""
            : "flex-1"}"
          @click=${() => this.handleClick()}
        >
          ${(c?.product ?? priceHard ?? priceSoft)
            ? html`<cosmetic-info
                .artist=${artist}
                .rarity=${c!.rarity}
                .colorPalette=${active.colorPalette?.name}
                .showAdFree=${isPurchasable}
              ></cosmetic-info>`
            : nothing}

          <div
            class="w-full aspect-square flex items-center justify-center bg-white/5 rounded-lg p-2 border border-white/10 group-hover:border-white/20 transition-colors duration-200 overflow-hidden"
          >
            ${this.renderPreview()}
          </div>
        </button>
        ${this.renderColorSwatches()}
        ${isOwnedSubscription
          ? html`<div
              class="w-full mt-2 px-2 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-base font-bold text-center"
            >
              ${translateText("store.subscribed")}
            </div>`
          : nothing}
      </cosmetic-container>
    `;
  }
}
