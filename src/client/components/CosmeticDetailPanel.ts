import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ResolvedCosmetic, translateCosmetic } from "../Cosmetics";
import { cosmeticDisplayName, cosmeticRarity } from "./CosmeticPresentation";
import "./CosmeticPreview";

@customElement("cosmetic-detail-panel")
export class CosmeticDetailPanel extends LitElement {
  @property({ type: String })
  context: "inventory" | "store" = "inventory";

  @property({ attribute: false })
  resolved: ResolvedCosmetic | null = null;

  @property({ attribute: false })
  variants: readonly ResolvedCosmetic[] = [];

  @property({ type: String })
  activeVariantKey: string | null = null;

  @property({ type: String })
  statusText = "";

  @property({ attribute: false })
  onVariantActivate?: (value: ResolvedCosmetic) => void;

  @property({ attribute: false })
  actionContent: TemplateResult | typeof nothing = nothing;

  createRenderRoot() {
    return this;
  }

  private renderSwatches() {
    const activeKey = this.activeVariantKey ?? this.resolved?.key;
    if (this.variants.length === 0) return nothing;

    return html`<div
      data-detail-swatches
      class="flex flex-wrap items-center gap-2"
    >
      ${this.variants.map((variant) => {
        const palette = variant.colorPalette;
        const primary = palette?.primaryColor ?? "#ffffff";
        const secondary = palette?.secondaryColor ?? "#000000";
        const label = palette
          ? translateCosmetic("territory_patterns.color_palette", palette.name)
          : cosmeticDisplayName(variant);
        const isActive = variant.key === activeKey;
        return html`<button
          type="button"
          data-detail-variant=${variant.key}
          aria-label=${label}
          aria-current=${isActive ? "true" : nothing}
          class="w-7 h-7 rounded-full p-0 appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ${isActive
            ? "ring-2 ring-white"
            : ""}"
          style="background-image: linear-gradient(135deg, ${primary} 0 calc(50% - 0.5px), rgba(255,255,255,0.55) calc(50% - 0.5px) calc(50% + 0.5px), ${secondary} calc(50% + 0.5px) 100%);"
          @click=${() => this.onVariantActivate?.(variant)}
        ></button>`;
      })}
    </div>`;
  }

  render() {
    const resolved = this.resolved;
    if (!resolved) return nothing;

    const palette = resolved.colorPalette;
    const colourway = palette
      ? translateCosmetic("territory_patterns.color_palette", palette.name)
      : "";
    const artist = (resolved.cosmetic as { artist?: string } | null)?.artist;

    return html`<section
      data-detail-context=${this.context}
      class="flex flex-col gap-4 rounded-xl border border-white/15 bg-slate-950/70 p-5"
    >
      <div
        class="aspect-square w-full max-h-80 flex items-center justify-center rounded-lg bg-white/5 p-4 overflow-hidden"
      >
        <cosmetic-preview
          .resolved=${resolved}
          size="detail"
        ></cosmetic-preview>
      </div>
      <div class="flex flex-col gap-2">
        <h2 data-detail-name class="text-xl font-bold text-white">
          ${cosmeticDisplayName(resolved)}
        </h2>
        <span
          data-detail-rarity
          class="text-sm uppercase tracking-wide text-white/60"
        >
          ${cosmeticRarity(resolved)}
        </span>
        ${artist
          ? html`<span data-detail-artist class="text-sm text-white/70"
              >${artist}</span
            >`
          : nothing}
        ${colourway
          ? html`<span data-detail-colourway class="text-sm text-white/70"
              >${colourway}</span
            >`
          : nothing}
      </div>
      ${this.renderSwatches()}
      <div
        data-detail-status
        role="status"
        class="min-h-5 text-sm text-white/80"
      >
        ${this.statusText}
      </div>
      ${this.actionContent}
    </section>`;
  }
}
