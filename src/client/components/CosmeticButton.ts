import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  Effect,
  Flag,
  Pack,
  Pattern,
  Skin,
  Subscription,
} from "../../core/CosmeticSchemas";
import {
  PaymentMethod,
  PurchaseResult,
  ResolvedCosmetic,
  translateCosmetic,
} from "../Cosmetics";
import { translateText } from "../Utils";
import "./CosmeticContainer";
import "./CosmeticInfo";
import { cosmeticDisplayName } from "./CosmeticPresentation";
import "./CosmeticPreview";

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
        variants.find((v) => v.key === this.activeVariantKey) ?? this.resolved
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

  /** Perk labels + in-depth explanations shown in the "?" tooltip. */
  private subscriptionPerks(): Array<{ label: string; info: string }> {
    if (this.activeResolved.type !== "subscription") return [];
    const sub = this.activeResolved.cosmetic as Subscription;
    const perks = [
      {
        label: translateText("cosmetics.verified_name"),
        info: translateText("cosmetics.verified_name_info"),
      },
    ];
    if (sub.unlimitedRanked) {
      perks.push({
        label: translateText("cosmetics.unlimited_ranked"),
        info: translateText("cosmetics.unlimited_ranked_info"),
      });
    }
    if (sub.canCreatePublicLobbies) {
      perks.push({
        label: translateText("cosmetics.public_lobbies"),
        info: translateText("cosmetics.public_lobbies_info"),
      });
    }
    return perks;
  }

  render() {
    const active = this.activeResolved;
    const displayName = cosmeticDisplayName(active);
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
    // Equivalent USD value at 20 plutonium = $1.00, shown only for items that
    // can't be bought directly with money but can be bought with plutonium.
    const usdValue =
      !c?.product && priceHard !== undefined ? priceHard / 20 : undefined;
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
        .name=${displayName}
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
                .usdValue=${usdValue}
                .perks=${this.subscriptionPerks()}
              ></cosmetic-info>`
            : nothing}

          <div
            class="w-full aspect-square flex items-center justify-center bg-white/5 rounded-lg p-2 border border-white/10 group-hover:border-white/20 transition-colors duration-200 overflow-hidden"
          >
            <cosmetic-preview
              .resolved=${active}
              size="card"
            ></cosmetic-preview>
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
