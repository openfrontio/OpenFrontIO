import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PurchaseResult, ResolvedCosmetic } from "../../Cosmetics";
import { type PricedItem, shownPrice } from "../../ShownPrice";
import { translateText } from "../../Utils";
import {
  cosmeticDisplayName,
  cosmeticRarityBadgeClass,
  cosmeticRarityLabel,
  cosmeticSelectionLabel,
  cosmeticTypeLabel,
} from "../CosmeticPresentation";
import "../CosmeticPreview";
import { isPreviewableCosmetic } from "../CosmeticPreviewBubble";
import "../PurchaseButton";
import { lockIcon } from "./InventoryItemTile";
import { unlockLabel } from "./ItemState";

/**
 * Preview and buy an item the player doesn't own, in place. The same
 * <purchase-button> as the Store, fed the same shownPrice values, so a sale
 * shows (and ends) identically. Nothing is equipped until the item is bought;
 * then the dialog offers "Equip now". An earned-only item shows how to unlock
 * it instead of a price.
 */
@customElement("inventory-buy-dialog")
export class InventoryBuyDialog extends LitElement {
  @property({ attribute: false }) resolved: ResolvedCosmetic | null = null;
  /** True once the player owns the item: the dialog offers Equip now. */
  @property({ type: Boolean }) bought = false;
  @property({ attribute: false })
  onPurchase?: (method: "hard" | "soft") => Promise<PurchaseResult>;
  @property({ attribute: false }) onEquip?: () => void;
  /** Opens the Store's full-screen 3D preview (skins and effects). */
  @property({ attribute: false }) onPreview?: () => void;
  @property({ attribute: false }) onClose?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    super.disconnectedCallback();
  }

  // Capture phase, so Escape closes this and not the Inventory behind it.
  private onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      document.querySelector("cosmetic-preview-modal")
    )
      return;
    event.stopPropagation();
    event.preventDefault();
    this.onClose?.();
  };

  private renderAction(resolved: ResolvedCosmetic) {
    if (this.bought) {
      return html`<div class="flex flex-col gap-2">
        <p data-buy-owned class="text-sm font-semibold text-white">
          ${translateText("inventory.buy_owned_now", {
            name: cosmeticSelectionLabel(resolved),
          })}
        </p>
        <button
          type="button"
          data-buy-equip-now
          class="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-black uppercase tracking-wider text-white hover:bg-blue-500"
          @click=${() => this.onEquip?.()}
        >
          ${translateText("inventory.buy_equip_now")}
        </button>
      </div>`;
    }
    const unlock = unlockLabel(resolved);
    if (unlock !== null) {
      return html`<div
        data-buy-unlock
        class="flex items-center gap-2 rounded-lg border border-dashed border-white/40 px-3 py-2 text-sm text-white/80"
      >
        ${lockIcon}
        <span
          ><span class="font-bold text-white"
            >${translateText("inventory.buy_how_to_unlock")}</span
          >
          ${unlock}</span
        >
      </div>`;
    }
    const priced = resolved.cosmetic as PricedItem | null;
    if (priced === null) return nothing;
    const hard = shownPrice(priced, "hard");
    const soft = shownPrice(priced, "soft");
    const saleLabel = hard?.saleLabel ?? soft?.saleLabel ?? null;
    return html`<div class="flex flex-col gap-2">
      ${
        saleLabel
          ? html`<span
              data-buy-sale-label
              class="text-xs font-bold uppercase tracking-wide text-white"
              >${saleLabel}</span
            >`
          : nothing
      }
      <purchase-button
        .priceHard=${hard?.price ?? null}
        .priceSoft=${soft?.price ?? null}
        .listPriceHard=${hard?.listPrice ?? null}
        .listPriceSoft=${soft?.listPrice ?? null}
        .promotion=${priced.promotion ?? null}
        .rarity=${resolved.cosmetic?.rarity ?? "common"}
        .itemName=${cosmeticSelectionLabel(resolved)}
        .onPurchaseHard=${hard ? () => this.onPurchase!("hard") : undefined}
        .onPurchaseSoft=${soft ? () => this.onPurchase!("soft") : undefined}
      ></purchase-button>
    </div>`;
  }

  render() {
    const resolved = this.resolved;
    if (resolved === null) return nothing;
    const name = cosmeticDisplayName(resolved);
    return html`<div
      data-inventory-buy
      role="dialog"
      aria-modal="true"
      aria-label=${name}
      class="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) this.onClose?.();
      }}
    >
      <div
        class="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-white/15 bg-zinc-900 p-5 shadow-2xl sm:rounded-2xl"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-xs font-semibold text-white/60"
              >${cosmeticTypeLabel(resolved)}</span
            >
            <h2 class="truncate text-lg font-bold capitalize text-white">
              ${cosmeticSelectionLabel(resolved)}
            </h2>
            <span
              class="w-fit rounded-full border px-2.5 py-0.5 text-xs font-black uppercase tracking-wider ${cosmeticRarityBadgeClass(
                resolved,
              )}"
              >${cosmeticRarityLabel(resolved)}</span
            >
          </div>
          <button
            type="button"
            data-buy-close
            aria-label=${translateText("common.close")}
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/15 hover:text-white"
            @click=${() => this.onClose?.()}
          >
            ✕
          </button>
        </div>
        <div
          class="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-black/40 p-3"
        >
          <cosmetic-preview
            .resolved=${resolved}
            size="detail"
          ></cosmetic-preview>
        </div>
        ${
          isPreviewableCosmetic(resolved) && this.onPreview
            ? html`<button
                type="button"
                data-buy-preview
                class="min-h-11 rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-bold text-white hover:bg-white/10"
                @click=${() => this.onPreview?.()}
              >
                ${translateText("inventory.buy_preview")}
              </button>`
            : nothing
        }
        ${this.renderAction(resolved)}
      </div>
    </div>`;
  }
}
