import { html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PurchaseResult, ResolvedCosmetic } from "../../Cosmetics";
import { type PricedItem, shownPrice } from "../../ShownPrice";
import { translateText } from "../../Utils";
import {
  cosmeticAiLabelKey,
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
  /** Changes when shown prices may have (a sale ended); prices are read
   * through shownPrice at render, so this only asks for a re-render. */
  @property({ type: Number }) priceEpoch = 0;
  @property({ attribute: false })
  onPurchase?: (
    method: "hard" | "soft",
    shownAmount?: number,
  ) => Promise<PurchaseResult>;
  @property({ attribute: false }) onEquip?: () => void;
  /** Opens the Store's full-screen 3D preview (skins and effects). */
  @property({ attribute: false }) onPreview?: () => void;
  @property({ attribute: false }) onClose?: () => void;

  createRenderRoot() {
    return this;
  }

  /** Where focus was when the dialog opened (the tile): it goes back there
   * when the dialog closes. */
  private returnFocusTo: HTMLElement | null = null;

  connectedCallback() {
    super.connectedCallback();
    const active = document.activeElement;
    this.returnFocusTo =
      active instanceof HTMLElement && active !== document.body ? active : null;
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    super.disconnectedCallback();
    if (this.returnFocusTo?.isConnected) this.returnFocusTo.focus();
    this.returnFocusTo = null;
  }

  // Focus moves into the dialog when it opens, and to Equip now once the
  // item is bought; never otherwise (a refreshed item, say, while the 3D
  // preview has focus).
  protected firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    if (!this.bought) {
      this.querySelector<HTMLElement>("[data-buy-close]")?.focus();
    }
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has("bought") && this.bought) {
      this.querySelector<HTMLElement>("[data-buy-equip-now]")?.focus();
    }
  }

  /** The dialog open over this one, if any: an alert from the purchase flow
   * (showInGameAlert puts it on document.body, above everything), or the
   * purchase button's own (confirm, or not enough currency). */
  private nestedConfirm(): Element | null {
    const alerts = document.querySelectorAll("body > confirm-dialog");
    if (alerts.length > 0) return alerts[alerts.length - 1];
    const own = this.querySelectorAll("confirm-dialog");
    return own.length > 0 ? own[own.length - 1] : null;
  }

  private focusables(): HTMLElement[] {
    return [
      ...this.querySelectorAll<HTMLElement>(
        "[data-buy-panel] button:not([disabled]), [data-buy-panel] [href], [data-buy-panel] input, [data-buy-panel] [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((el) => !el.closest("[hidden]"));
  }

  // Capture phase, so Escape closes this and not the Inventory behind it.
  private onKeyDown = (event: KeyboardEvent) => {
    // The 3D preview is on top: it handles its own keys.
    if (document.querySelector("cosmetic-preview-modal")) return;
    const nested = this.nestedConfirm();
    if (event.key === "Tab" && nested === null) {
      // Keep focus inside the dialog.
      const items = this.focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && this.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key !== "Escape") return;
    // Escape is ours, never the Inventory's behind us. It closes the topmost
    // dialog: an alert or the purchase button's own first (as its Cancel
    // does), then this.
    event.stopPropagation();
    event.preventDefault();
    if (nested !== null) {
      nested.dispatchEvent(new CustomEvent("cancel"));
      return;
    }
    this.onClose?.();
  };

  private renderCredits(resolved: ResolvedCosmetic) {
    const credits = resolved.cosmetic as {
      artist?: string;
      aiDisclosed?: boolean;
    } | null;
    const artist = credits?.artist;
    const aiLabelKey = cosmeticAiLabelKey(credits?.aiDisclosed, artist);
    if (!artist && !aiLabelKey) return nothing;
    return html`<div
      data-buy-credits
      class="flex flex-col text-xs text-white/60"
    >
      ${
        artist
          ? html`<span data-buy-artist
              >${translateText("cosmetics.artist_label")}
              <span class="font-medium text-white/90">${artist}</span></span
            >`
          : nothing
      }
      ${
        aiLabelKey
          ? html`<span data-buy-ai>${translateText(aiLabelKey)}</span>`
          : nothing
      }
    </div>`;
  }

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
        .busyKey=${resolved.key}
        .onPurchaseHard=${
          hard ? (shown?: number) => this.onPurchase!("hard", shown) : undefined
        }
        .onPurchaseSoft=${
          soft ? (shown?: number) => this.onPurchase!("soft", shown) : undefined
        }
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
        data-buy-panel
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
            ${this.renderCredits(resolved)}
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
