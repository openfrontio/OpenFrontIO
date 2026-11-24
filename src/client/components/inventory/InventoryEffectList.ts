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
      <div class="flex min-h-14 items-center gap-3 px-3 py-2">
        <span
          data-effect-row-item
          class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white"
        >
          <span
            data-effect-row-name
            class="w-full text-sm font-bold text-white lg:w-36 lg:shrink-0"
            >${translateText(`inventory.effect_slot.${row.slot}`)}</span
          >
          <span class="flex min-w-0 flex-1 items-center gap-2">
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
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-semibold"
                >${
                  row.item
                    ? cosmeticDisplayName(row.item)
                    : translateText("inventory.effect_default")
                }</span
              >
              <span class="flex flex-wrap gap-x-2 text-xs text-white/50">
                ${
                  row.item
                    ? html`<span
                        class="text-[11px] font-black uppercase tracking-wider"
                        >${cosmeticRarityLabel(row.item)}</span
                      >`
                    : nothing
                }
                <span data-effect-row-owned
                  >${translateText("inventory.owned_count", {
                    count: row.ownedCount,
                  })}</span
                >
              </span>
            </span>
          </span>
        </span>
        <button
          type="button"
          data-effect-row-change
          aria-expanded=${open ? "true" : "false"}
          aria-label=${translateText(
            open
              ? "inventory.effect_close_slot"
              : "inventory.effect_change_slot",
            { slot: translateText(`inventory.effect_slot.${row.slot}`) },
          )}
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
