import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";

const rarityColors: Record<string, string> = {
  common: "text-white/60",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  epic: "text-purple-300",
  legendary: "text-orange-400",
};

@customElement("cosmetic-info")
export class CosmeticInfo extends LitElement {
  @property({ type: String }) artist?: string;
  @property({ type: String }) rarity?: string;
  @property({ type: String }) colorPalette?: string;
  @property({ type: Boolean }) showAdFree = false;
  @property({ type: Number }) usdValue?: number;
  @property({ type: Array }) perks: Array<{ label: string; info: string }> = [];
  /** Display names of a pack's contents, listed under "Includes:". */
  @property({ type: Array }) items: string[] = [];

  createRenderRoot() {
    return this;
  }

  render() {
    if (
      !this.artist &&
      !this.rarity &&
      !this.colorPalette &&
      !this.showAdFree &&
      this.usdValue === undefined &&
      this.perks.length === 0 &&
      this.items.length === 0
    ) {
      return nothing;
    }

    const rarityColor = rarityColors[this.rarity ?? ""] ?? "text-white/70";
    // The strip spans the card so the bubble (right-aligned under the "?")
    // can be capped at the card's width and wrap. Sized to its longest line,
    // it used to run past the modal's left edge on first-column cards and
    // get clipped. Only the button takes pointer events.
    return html`<div
      data-cosmetic-info
      class="group/cosmetic-info pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-end"
      @click=${(event: Event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Show cosmetic details"
        class="pointer-events-auto flex h-7 w-7 cursor-help items-center justify-center rounded-full bg-black/55 text-xs font-black text-white/80 ring-1 ring-white/20 transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        ?
      </button>
      <div
        role="tooltip"
        class="pointer-events-none absolute right-0 top-9 hidden w-max max-w-full flex-col gap-0.5 whitespace-normal rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-left text-xs text-white shadow-xl group-hover/cosmetic-info:flex group-focus-within/cosmetic-info:flex"
      >
        ${this.rarity
          ? html`<div class="font-bold uppercase tracking-wider ${rarityColor}">
              ${translateText(`cosmetics.${this.rarity}`)}
            </div>`
          : nothing}
        ${this.showAdFree
          ? html`<div class="font-bold text-green-400">
              ${translateText("cosmetics.adfree")}
            </div>`
          : nothing}
        ${this.usdValue !== undefined
          ? html`<div>
              ${translateText("cosmetics.usd_value", {
                usd: `$${this.usdValue.toFixed(2)}`,
              })}
            </div>`
          : nothing}
        ${this.perks.map(
          (perk) =>
            html`<div class="max-w-56">
              <span class="font-bold text-purple-300">${perk.label}:</span>
              <span class="text-white/80">${perk.info}</span>
            </div>`,
        )}
        ${this.items.length > 0
          ? html`<div data-cosmetic-info-items class="max-w-56">
              <span class="font-bold text-purple-300"
                >${translateText("cosmetics.pack_includes")}</span
              >
              <span class="text-white/80">${this.items.join(", ")}</span>
            </div>`
          : nothing}
        ${this.colorPalette
          ? html`<div>
              ${translateText("cosmetics.color_label")}
              ${translateCosmetic(
                "territory_patterns.color_palette",
                this.colorPalette,
              )}
            </div>`
          : nothing}
        ${this.artist
          ? html`<div>
              ${translateText("cosmetics.artist_label")} ${this.artist}
            </div>`
          : nothing}
      </div>
    </div>`;
  }
}
