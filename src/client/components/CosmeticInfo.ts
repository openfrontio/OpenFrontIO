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
  @property({ type: String })
  artist?: string;

  @property({ type: String })
  rarity?: string;

  @property({ type: String })
  colorPalette?: string;

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.artist && !this.rarity && !this.colorPalette) {
      return nothing;
    }

    const rarityColor = rarityColors[this.rarity ?? ""] ?? "text-white/70";

    return html`
      <div
        class="absolute -top-1 -right-1 z-10 group/artist"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div
          class="w-6 h-6 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center cursor-help transition-colors duration-150"
        >
          <span class="text-xs font-bold text-white/70">?</span>
        </div>
        <div
          class="hidden group-hover/artist:block absolute top-7 right-0 bg-zinc-800 text-white text-xs px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap z-20 border border-white/10 flex flex-col gap-0.5"
        >
          ${this.rarity
            ? html`<div
                class="font-bold uppercase tracking-wider ${rarityColor}"
              >
                ${translateText(`cosmetics.${this.rarity}`) || this.rarity}
              </div>`
            : nothing}
          <div class="text-green-400 font-bold">
            ${translateText("cosmetics.adfree")}
          </div>
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
      </div>
    `;
  }
}
