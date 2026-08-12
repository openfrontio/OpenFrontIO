import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Subscription } from "../../core/CosmeticSchemas";
import { ResolvedCosmetic, translateCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";
import "./CosmeticInfo";
import { cosmeticDisplayName, cosmeticRarity } from "./CosmeticPresentation";
import "./CosmeticPreview";

const COSMETIC_CARD_STYLE_ID = "cosmetic-card-styles";
if (!document.getElementById(COSMETIC_CARD_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = COSMETIC_CARD_STYLE_ID;
  style.textContent = `
    @keyframes cosmetic-card-legendary-pulse {
      0%, 100% { box-shadow: 0 0 15px rgba(251,146,60,0.8), 0 0 30px rgba(251,146,60,0.4); }
      50% { box-shadow: 0 0 25px rgba(251,146,60,0.9), 0 0 45px rgba(251,146,60,0.5); }
    }
    @keyframes cosmetic-card-shimmer {
      0% { left: -60%; }
      100% { left: 160%; }
    }
    @keyframes cosmetic-card-border-sweep {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes cosmetic-card-sparkle-0 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      40%, 60% { opacity: 1; transform: scale(1.2) rotate(20deg); }
    }
    @keyframes cosmetic-card-sparkle-1 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      30%, 55% { opacity: 1; transform: scale(1.1) rotate(-15deg); }
    }
    @keyframes cosmetic-card-sparkle-2 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      45%, 65% { opacity: 1; transform: scale(1.3) rotate(10deg); }
    }
    @keyframes cosmetic-card-sparkle-3 {
      0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
      35%, 58% { opacity: 1; transform: scale(1) rotate(-20deg); }
    }

    [data-cosmetic-shell][data-cosmetic-rarity="common"] {
      background: linear-gradient(to top, rgba(80,80,80,0.55) 0%, rgba(15,15,20,0.85) 100%);
      border-color: rgba(255,255,255,0.15);
    }
    [data-cosmetic-shell][data-cosmetic-rarity="uncommon"] {
      background: linear-gradient(to top, rgba(30,100,30,0.65) 0%, rgba(15,15,20,0.85) 100%);
      border-color: rgba(74,222,128,0.45);
    }
    [data-cosmetic-shell][data-cosmetic-rarity="rare"] {
      background: linear-gradient(to top, rgba(20,60,160,0.7) 0%, rgba(15,15,20,0.85) 100%);
      border-color: rgba(96,165,250,0.5);
    }
    [data-cosmetic-shell][data-cosmetic-rarity="epic"] {
      background: linear-gradient(to top, rgba(90,20,160,0.75) 0%, rgba(15,15,20,0.85) 100%);
      border-color: rgba(192,132,252,0.6);
    }
    [data-cosmetic-shell][data-cosmetic-rarity="legendary"] {
      background: linear-gradient(to top, rgba(180,80,0,0.75) 0%, rgba(15,15,20,0.85) 100%);
      border-color: rgba(251,146,60,0.65);
    }

    cosmetic-card:hover { position: relative; z-index: 10; }
    cosmetic-card:hover [data-cosmetic-shell][data-cosmetic-rarity="common"] {
      transform: translateY(-4px);
      box-shadow: 0 0 10px rgba(255,255,255,0.5);
    }
    cosmetic-card:hover [data-cosmetic-shell][data-cosmetic-rarity="uncommon"] {
      transform: translateY(-4px);
      box-shadow: 0 0 12px rgba(74,222,128,0.6);
    }
    cosmetic-card:hover [data-cosmetic-shell][data-cosmetic-rarity="rare"] {
      transform: translateY(-4px);
      box-shadow: 0 0 14px rgba(96,165,250,0.7);
    }
    cosmetic-card:hover [data-cosmetic-shell][data-cosmetic-rarity="epic"] {
      transform: translateY(-4px);
      box-shadow: 0 0 14px rgba(192,132,252,0.85);
    }
    cosmetic-card:hover [data-cosmetic-shell][data-cosmetic-rarity="legendary"] {
      transform: translateY(-6px) scale(1.12);
      animation: cosmetic-card-legendary-pulse 1.4s ease-in-out infinite;
    }

    [data-cosmetic-main], [data-cosmetic-action] {
      position: relative;
      z-index: 3;
    }
    [data-cosmetic-shimmer] {
      pointer-events: none;
      position: absolute;
      inset: 0;
      z-index: 2;
      overflow: hidden;
      border-radius: 0.75rem;
      opacity: 0;
    }
    [data-cosmetic-shimmer]::after {
      content: "";
      pointer-events: none;
      position: absolute;
      top: 0;
      left: -60%;
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, transparent 0%, rgba(192,132,252,0.45) 50%, transparent 100%);
      transform: skewX(-15deg);
    }
    [data-cosmetic-rarity="legendary"] [data-cosmetic-shimmer]::after {
      background: linear-gradient(90deg, transparent 0%, rgba(255,200,80,0.5) 50%, transparent 100%);
    }
    cosmetic-card:hover [data-cosmetic-shimmer] { opacity: 1; }
    cosmetic-card:hover [data-cosmetic-shimmer]::after {
      animation: cosmetic-card-shimmer 0.8s ease-in-out;
    }

    /* A gold conic gradient spinning about the card's centre, clipped to the
       card's rounded box. z-index:-1 puts it above the shell's own background
       but below the card content, so it reads as a full-card overlay sweeping
       around behind the preview and name. */
    [data-cosmetic-border-sweep] {
      pointer-events: none;
      position: absolute;
      inset: -2px;
      z-index: -1;
      display: block;
      border-radius: 0.85rem;
      overflow: hidden;
      opacity: 0;
    }
    [data-cosmetic-border-sweep]::after {
      content: "";
      position: absolute;
      inset: -100%;
      transform-origin: center;
      will-change: transform;
      background: conic-gradient(
        from 0deg,
        transparent 0deg,
        rgba(255,200,80,0) 60deg,
        rgba(255,200,80,0.9) 120deg,
        rgba(255,200,80,1) 180deg,
        rgba(255,200,80,0.9) 240deg,
        rgba(255,200,80,0) 300deg,
        transparent 360deg
      );
    }
    cosmetic-card:hover [data-cosmetic-border-sweep] {
      opacity: 1;
    }
    cosmetic-card:hover [data-cosmetic-border-sweep]::after {
      animation: cosmetic-card-border-sweep 8s linear infinite;
    }

    [data-cosmetic-sparkle] {
      pointer-events: none;
      position: absolute;
      z-index: 11;
      display: block;
      color: rgba(255,220,100,0.9);
      font-size: 10px;
      line-height: 1;
      opacity: 0;
      text-shadow: 0 0 6px rgba(255,200,60,1);
    }
    cosmetic-card:hover [data-cosmetic-sparkle="0"] { animation: cosmetic-card-sparkle-0 1.6s ease-in-out infinite; }
    cosmetic-card:hover [data-cosmetic-sparkle="1"] { animation: cosmetic-card-sparkle-1 1.9s ease-in-out infinite 0.3s; }
    cosmetic-card:hover [data-cosmetic-sparkle="2"] { animation: cosmetic-card-sparkle-2 1.7s ease-in-out infinite 0.7s; }
    cosmetic-card:hover [data-cosmetic-sparkle="3"] { animation: cosmetic-card-sparkle-3 2s ease-in-out infinite 0.1s; }

    /* No prefers-reduced-motion opt-out: these animations are the legendary
       treatment, and suppressing them left the card with a frozen gold wash
       and invisible (opacity: 0) sparkles rather than a calmer effect. */
  `;
  document.head.appendChild(style);
}

export type CosmeticCardState = "idle" | "focused" | "equipped";

@customElement("cosmetic-card")
export class CosmeticCard extends LitElement {
  @property({ attribute: false })
  resolved!: ResolvedCosmetic;

  @property({ attribute: false })
  variants: readonly ResolvedCosmetic[] = [];

  @property({ type: String })
  activeVariantKey: string | null = null;

  @property({ type: String })
  state: CosmeticCardState = "idle";

  @property({ type: Boolean })
  showSwatches = true;

  @property({ type: Boolean })
  interactive = true;

  @property({ attribute: false })
  onActivate?: (resolved: ResolvedCosmetic) => void;

  @property({ attribute: false })
  onVariantActivate?: (resolved: ResolvedCosmetic) => void;

  @property({ attribute: false })
  actionContent: TemplateResult | typeof nothing = nothing;

  private get activeResolved(): ResolvedCosmetic {
    return (
      this.variants.find((item) => item.key === this.activeVariantKey) ??
      this.resolved
    );
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("mouseenter", this.onHoverStart);
    this.addEventListener("mouseleave", this.onHoverEnd);
  }

  disconnectedCallback() {
    this.removeEventListener("mouseenter", this.onHoverStart);
    this.removeEventListener("mouseleave", this.onHoverEnd);
    this.onHoverEnd();
    super.disconnectedCallback();
  }

  /** Page-wide dim behind a hovered legendary card, shared by all cards. */
  private static backdrop: HTMLDivElement | null = null;

  private static ensureBackdrop(): HTMLDivElement {
    CosmeticCard.backdrop ??= (() => {
      const el = document.createElement("div");
      el.dataset.cosmeticBackdrop = "";
      el.style.cssText = `
        pointer-events: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0);
        z-index: 9;
        transition: background 0.3s ease;
      `;
      document.body.appendChild(el);
      return el;
    })();
    return CosmeticCard.backdrop;
  }

  private onHoverStart = () => {
    if (cosmeticRarity(this.activeResolved) !== "legendary") return;
    CosmeticCard.ensureBackdrop().style.background = "rgba(0,0,0,0.6)";
  };

  private onHoverEnd = () => {
    if (CosmeticCard.backdrop === null) return;
    CosmeticCard.backdrop.style.background = "rgba(0,0,0,0)";
  };

  updated() {
    this.dataset.cosmeticState = this.state;
  }

  private rarityClass(rarity: string): string {
    switch (rarity) {
      case "uncommon":
        return "border-zinc-300/70";
      case "rare":
        return "border-violet-300/70";
      case "epic":
        return "border-fuchsia-300/70";
      case "legendary":
        return "border-amber-400/70";
      default:
        return "border-white/20";
    }
  }

  private rarityHoverClass(rarity: string): string {
    switch (rarity) {
      case "uncommon":
        return "hover:shadow-[0_14px_30px_rgba(74,222,128,0.22)]";
      case "rare":
        return "hover:shadow-[0_14px_30px_rgba(96,165,250,0.28)]";
      case "epic":
        return "hover:shadow-[0_14px_34px_rgba(232,121,249,0.32)]";
      case "legendary":
        return "hover:shadow-[0_16px_38px_rgba(251,191,36,0.38)]";
      default:
        return "hover:shadow-[0_12px_26px_rgba(255,255,255,0.14)]";
    }
  }

  private renderSwatches() {
    const variants = this.variants.filter(
      (variant) => variant.colorPalette !== null,
    );
    if (!this.interactive || !this.showSwatches || variants.length === 0) {
      return nothing;
    }

    const activeKey = this.activeResolved.key;
    return html`<div
      data-cosmetic-swatches
      class="flex flex-wrap items-center justify-center gap-1 w-full pt-2"
    >
      ${variants.map((variant) => {
        const palette = variant.colorPalette;
        const primary = palette?.primaryColor ?? "#ffffff";
        const secondary = palette?.secondaryColor ?? "#000000";
        const isActive = variant.key === activeKey;
        const label = palette
          ? translateCosmetic("territory_patterns.color_palette", palette.name)
          : cosmeticDisplayName(variant);
        return html`<button
          type="button"
          data-variant-key=${variant.key}
          title=${label}
          aria-label=${label}
          aria-pressed=${isActive ? "true" : "false"}
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 m-0 appearance-none cursor-pointer outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-1 transition-transform duration-150 hover:scale-110"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.onVariantActivate?.(variant);
          }}
        >
          <span
            data-cosmetic-swatch-dot
            aria-hidden="true"
            class="h-5 w-5 rounded-full ${isActive
              ? "scale-110 ring-2 ring-white"
              : ""}"
            style="background-image: linear-gradient(135deg, ${primary} 0 calc(50% - 0.5px), rgba(255,255,255,0.55) calc(50% - 0.5px) calc(50% + 0.5px), ${secondary} calc(50% + 0.5px) 100%);"
          ></span>
        </button>`;
      })}
    </div>`;
  }

  private subscriptionPerks(): Array<{ label: string; info: string }> {
    if (this.activeResolved.type !== "subscription") return [];
    const subscription = this.activeResolved.cosmetic as Subscription;
    const perks = [
      {
        label: translateText("cosmetics.verified_name"),
        info: translateText("cosmetics.verified_name_info"),
      },
    ];
    if (subscription.unlimitedRanked) {
      perks.push({
        label: translateText("cosmetics.unlimited_ranked"),
        info: translateText("cosmetics.unlimited_ranked_info"),
      });
    }
    if (subscription.canCreatePublicLobbies) {
      perks.push({
        label: translateText("cosmetics.public_lobbies"),
        info: translateText("cosmetics.public_lobbies_info"),
      });
    }
    return perks;
  }

  render() {
    const active = this.activeResolved;
    const rarity = cosmeticRarity(active);
    const displayName = cosmeticDisplayName(active);
    const isFocused = this.state === "focused";
    const isEquipped = this.state === "equipped";
    const shellClass = `${this.rarityClass(rarity)} ${
      isEquipped
        ? "ring-2 ring-emerald-400/70 shadow-[0_0_24px_rgba(52,211,153,0.45)]"
        : ""
    } ${this.rarityHoverClass(rarity)}`;
    const priced = active.cosmetic as {
      artist?: string;
      product?: unknown;
      priceHard?: number;
    } | null;
    const usdValue =
      (priced?.product === null || priced?.product === undefined) &&
      priced?.priceHard !== undefined
        ? priced.priceHard / 20
        : undefined;
    // A subscription lists its perks as text, which wraps to more lines than a
    // square box holds once cards are phone-width — let it take the height it
    // needs rather than clipping the last perk.
    const previewShape =
      active.type === "subscription" ? "h-auto" : "aspect-square";
    const content = html`
      <div
        class="w-full ${previewShape} flex items-center justify-center bg-white/5 rounded-lg p-2 overflow-hidden"
      >
        <cosmetic-preview .resolved=${active} size="card"></cosmetic-preview>
      </div>
      <span
        data-cosmetic-name
        class="w-full whitespace-normal break-words text-center text-sm font-bold leading-tight text-white"
        >${displayName}</span
      >
    `;

    return html`<div
      data-cosmetic-shell
      data-cosmetic-state=${this.state}
      data-cosmetic-rarity=${rarity}
      class="relative flex h-full flex-col items-center overflow-visible rounded-xl border transition-all duration-200 ease-out hover:-translate-y-1 ${shellClass}"
    >
      ${rarity === "epic" || rarity === "legendary"
        ? html`<span data-cosmetic-shimmer aria-hidden="true"></span>`
        : nothing}
      ${rarity === "legendary"
        ? html`<span data-cosmetic-border-sweep aria-hidden="true"></span>
            <span
              data-cosmetic-sparkle="0"
              aria-hidden="true"
              style="top: 4px; left: 4px"
              >✦</span
            >
            <span
              data-cosmetic-sparkle="1"
              aria-hidden="true"
              style="top: 4px; right: 4px"
              >✦</span
            >
            <span
              data-cosmetic-sparkle="2"
              aria-hidden="true"
              style="bottom: 4px; left: 4px"
              >✦</span
            >
            <span
              data-cosmetic-sparkle="3"
              aria-hidden="true"
              style="bottom: 4px; right: 4px"
              >✦</span
            >`
        : nothing}
      ${this.interactive
        ? html`<button
            type="button"
            data-cosmetic-main
            aria-label=${displayName}
            aria-pressed=${isEquipped ? "true" : nothing}
            aria-current=${isFocused ? "true" : nothing}
            class="group relative flex flex-col items-center gap-2 w-full rounded-xl p-3 cursor-pointer outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-1"
            @click=${() => this.onActivate?.(active)}
          >
            ${content}
          </button>`
        : html`<div
            data-cosmetic-main
            class="group relative flex w-full flex-col items-center gap-2 rounded-xl p-3"
          >
            ${content}
          </div>`}
      ${isEquipped
        ? html`<span
            data-cosmetic-equipped="true"
            class="absolute left-2 top-2 z-[4] rounded-full bg-emerald-500 px-3 py-1 text-xs font-black uppercase tracking-wide text-white shadow-lg shadow-emerald-950/60 ring-1 ring-emerald-200/70"
            >✓ ${translateText("inventory.equipped")}</span
          >`
        : nothing}
      ${this.interactive && active.cosmetic !== null
        ? html`<cosmetic-info
            .artist=${priced?.artist}
            .rarity=${rarity}
            .colorPalette=${active.colorPalette?.name}
            .showAdFree=${active.relationship === "purchasable"}
            .usdValue=${usdValue}
            .perks=${this.subscriptionPerks()}
          ></cosmetic-info>`
        : nothing}
      ${this.renderSwatches()}
      ${this.actionContent !== nothing
        ? html`<div data-cosmetic-action class="mt-auto w-full px-3 pb-3 pt-2">
            ${this.actionContent}
          </div>`
        : nothing}
    </div>`;
  }
}
