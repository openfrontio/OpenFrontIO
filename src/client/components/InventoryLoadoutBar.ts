import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ResolvedCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";
import "./CosmeticPreview";

export type InventoryCategory = "skins" | "flags" | "crowns" | "effects";

export interface InventoryLoadoutEntry {
  category: InventoryCategory;
  label: string;
  items: readonly ResolvedCosmetic[];
  summary: string;
}

@customElement("inventory-loadout-bar")
export class InventoryLoadoutBar extends LitElement {
  @property({ attribute: false })
  entries: readonly InventoryLoadoutEntry[] = [];

  @property({ type: String })
  activeCategory: InventoryCategory = "skins";

  @property({ attribute: false })
  onCategorySelect?: (category: InventoryCategory) => void;

  createRenderRoot() {
    return this;
  }

  private renderPreviews(entry: InventoryLoadoutEntry) {
    const items =
      entry.category === "effects"
        ? entry.items.slice(0, 3)
        : entry.items.slice(0, 1);
    const hiddenCount = entry.items.length - items.length;

    return html`<div
      data-loadout-previews
      class="flex h-10 items-center justify-center ${entry.category ===
      "effects"
        ? "-space-x-3"
        : ""}"
    >
      ${items.map(
        (item, index) =>
          html`<div
            data-loadout-preview
            class="h-10 w-10 overflow-hidden rounded-lg border border-white/20 bg-black/30 p-1 ${entry.category ===
            "effects"
              ? "relative"
              : ""}"
            style=${entry.category === "effects"
              ? `z-index:${3 - index}`
              : nothing}
          >
            <cosmetic-preview .resolved=${item}></cosmetic-preview>
          </div>`,
      )}
      ${hiddenCount > 0
        ? html`<span
            data-loadout-more
            class="relative z-10 flex h-7 min-w-7 items-center justify-center rounded-full border border-white/20 bg-slate-800 px-1 text-xs font-black text-white"
            >+${hiddenCount}</span
          >`
        : nothing}
    </div>`;
  }

  render() {
    return html`<section
      data-inventory-loadout
      aria-label=${translateText("inventory.loadout")}
    >
      <h2 class="sr-only">${translateText("inventory.loadout")}</h2>
      <div class="overflow-x-auto overflow-y-visible px-3 py-2">
        <div class="mx-auto flex w-max min-w-max gap-3">
          ${this.entries.map((entry) => {
            const isActive = entry.category === this.activeCategory;
            const ariaSummary =
              entry.category === "effects"
                ? translateText("inventory.showing_effects", {
                    count: entry.items.length,
                  })
                : entry.summary;
            return html`<button
              type="button"
              data-loadout-category=${entry.category}
              aria-pressed=${isActive ? "true" : "false"}
              aria-label=${translateText("inventory.loadout_category_label", {
                category: entry.label,
                summary: ariaSummary,
              })}
              class="flex min-h-24 min-w-36 flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${isActive
                ? "border-blue-400 bg-blue-500/20 text-white"
                : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"}"
              @click=${() => this.onCategorySelect?.(entry.category)}
            >
              ${this.renderPreviews(entry)}
              <span class="text-sm font-bold">${entry.label}</span>
              <span class="text-xs text-white/60">${entry.summary}</span>
            </button>`;
          })}
        </div>
      </div>
    </section>`;
  }
}
