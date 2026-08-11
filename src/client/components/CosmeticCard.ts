import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ResolvedCosmetic, translateCosmetic } from "../Cosmetics";
import { cosmeticDisplayName, cosmeticRarity } from "./CosmeticPresentation";
import "./CosmeticPreview";

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

  @property({ attribute: false })
  onActivate?: (resolved: ResolvedCosmetic) => void;

  @property({ attribute: false })
  onVariantActivate?: (resolved: ResolvedCosmetic) => void;

  private get activeResolved(): ResolvedCosmetic {
    return (
      this.variants.find((item) => item.key === this.activeVariantKey) ??
      this.resolved
    );
  }

  createRenderRoot() {
    return this;
  }

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

  private renderSwatches() {
    if (!this.showSwatches || this.variants.length === 0) {
      return nothing;
    }

    const activeKey = this.activeResolved.key;
    return html`<div
      data-cosmetic-swatches
      class="flex flex-wrap items-center justify-center gap-1.5 w-full px-1 pt-2"
    >
      ${this.variants.map((variant) => {
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
          aria-current=${isActive ? "true" : nothing}
          class="w-5 h-5 shrink-0 rounded-full p-0 m-0 appearance-none cursor-pointer outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 transition-transform duration-150 hover:scale-110 ${isActive
            ? "scale-110 ring-2 ring-white"
            : ""}"
          style="background-image: linear-gradient(135deg, ${primary} 0 calc(50% - 0.5px), rgba(255,255,255,0.55) calc(50% - 0.5px) calc(50% + 0.5px), ${secondary} calc(50% + 0.5px) 100%);"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.onVariantActivate?.(variant);
          }}
        ></button>`;
      })}
    </div>`;
  }

  render() {
    const active = this.activeResolved;
    const rarity = cosmeticRarity(active);
    const displayName = cosmeticDisplayName(active);
    const isFocused = this.state === "focused";
    const isEquipped = this.state === "equipped";
    const focusClass = isFocused
      ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-950"
      : "";

    return html`<div
      data-cosmetic-state=${this.state}
      data-cosmetic-rarity=${rarity}
      class="relative flex flex-col items-center rounded-xl border ${this.rarityClass(
        rarity,
      )} ${focusClass}"
    >
      <button
        type="button"
        data-cosmetic-main
        aria-label=${displayName}
        aria-pressed=${isEquipped ? "true" : nothing}
        aria-current=${isFocused ? "true" : nothing}
        class="group relative flex flex-col items-center gap-2 w-full rounded-xl p-3 cursor-pointer outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
        @click=${() => this.onActivate?.(active)}
      >
        <div
          class="w-full aspect-square flex items-center justify-center bg-white/5 rounded-lg p-2 overflow-hidden"
        >
          <cosmetic-preview .resolved=${active} size="card"></cosmetic-preview>
        </div>
        <span
          data-cosmetic-name
          class="w-full truncate text-center text-sm font-bold text-white"
          >${displayName}</span
        >
      </button>
      ${isEquipped
        ? html`<span
            data-cosmetic-equipped="true"
            class="absolute top-2 right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white"
            >✓ Equipped</span
          >`
        : nothing}
      ${this.renderSwatches()}
    </div>`;
  }
}
