import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ResolvedCosmetic } from "../../Cosmetics";
import { translateText } from "../../Utils";
import {
  cosmeticDisplayName,
  cosmeticRarityLabel,
} from "../CosmeticPresentation";
import "../CosmeticPreview";

export interface EffectRow {
  slot: string;
  /** The effect in use, or null for the default. */
  item: ResolvedCosmetic | null;
  ownedCount: number;
}

/**
 * The In game tab's Effects: one row per effect slot with the effect in use,
 * how many the player owns, and Change, which opens that slot's grid inline
 * under the row. On phones the slots are also a row of chips above the list.
 */
@customElement("inventory-effect-list")
export class InventoryEffectList extends LitElement {
  @property({ attribute: false }) rows: readonly EffectRow[] = [];
  @property({ type: String }) openSlot: string | null = null;
  @property({ attribute: false }) onToggle?: (slot: string) => void;
  @property({ attribute: false })
  renderGrid?: (slot: string) => TemplateResult;

  createRenderRoot() {
    return this;
  }

  private renderChips() {
    return html`<div
      data-effect-chips
      class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 md:hidden [scrollbar-width:none]"
    >
      ${this.rows.map((row) => {
        const open = row.slot === this.openSlot;
        return html`<button
          type="button"
          data-effect-chip=${row.slot}
          aria-pressed=${open ? "true" : "false"}
          class="min-h-11 shrink-0 rounded-full border px-4 text-xs font-bold ${
            open
              ? "border-blue-400 bg-blue-500/20 text-white"
              : "border-white/15 bg-white/5 text-white/75"
          }"
          @click=${() => this.onToggle?.(row.slot)}
        >
          ${translateText(`inventory.effect_slot.${row.slot}`)}
        </button>`;
      })}
    </div>`;
  }

  private renderRow(row: EffectRow) {
    const open = row.slot === this.openSlot;
    return html`<li
      data-effect-row=${row.slot}
      class="border-b border-white/10 last:border-b-0 ${
        open ? "bg-white/[0.03]" : ""
      }"
    >
      <div
        class="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
      >
        <span
          data-effect-row-name
          class="w-full text-sm font-bold text-white sm:w-44 sm:shrink-0"
          >${translateText(`inventory.effect_slot.${row.slot}`)}</span
        >
        <span
          data-effect-row-item
          class="flex min-w-0 flex-1 items-center gap-2 text-sm text-white"
        >
          <span
            class="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-white/15 bg-black/40"
            >${
              row.item
                ? html`<cosmetic-preview
                    .resolved=${row.item}
                  ></cosmetic-preview>`
                : nothing
            }</span
          >
          <span class="truncate font-semibold capitalize"
            >${
              row.item
                ? cosmeticDisplayName(row.item)
                : translateText("inventory.effect_default")
            }</span
          >
          ${
            row.item
              ? html`<span
                  class="text-[11px] font-black uppercase tracking-wider text-white/50"
                  >${cosmeticRarityLabel(row.item)}</span
                >`
              : nothing
          }
        </span>
        <span data-effect-row-owned class="text-xs text-white/50"
          >${translateText("inventory.owned_count", {
            count: row.ownedCount,
          })}</span
        >
        <button
          type="button"
          data-effect-row-change
          aria-expanded=${open ? "true" : "false"}
          class="min-h-11 min-w-24 rounded-lg border px-4 text-xs font-bold ${
            open
              ? "border-blue-400/70 bg-blue-500/15 text-white"
              : "border-white/15 bg-white/5 text-white hover:bg-white/10"
          }"
          @click=${() => this.onToggle?.(row.slot)}
        >
          ${translateText(open ? "common.close" : "inventory.effect_change")}
        </button>
      </div>
      ${
        open && this.renderGrid
          ? html`<div data-effect-row-grid class="px-3 pb-3">
              ${this.renderGrid(row.slot)}
            </div>`
          : nothing
      }
    </li>`;
  }

  render() {
    return html`${this.renderChips()}
      <ul
        data-effect-list
        class="overflow-hidden rounded-xl border border-white/10"
      >
        ${this.rows.map((row) => this.renderRow(row))}
      </ul>`;
  }
}
