import type { StorePlacement } from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { cardItemName } from "../../components/card/CardItems";
import "../../components/CosmeticCard";
import "../../components/PurchaseButton";
import {
  currentPrice,
  purchaseCosmetic,
  type ResolvedCosmetic,
  saleHasEnded,
} from "../../Cosmetics";
import { translateText } from "../../Utils";

// "Get {name}'s look": on the eliminated-by screen, up to three things the
// player who eliminated you has on their card, in the promo box's place (the
// store-skins turn). Paid items buy in Plutonium or caps like the store;
// earned ones show how to unlock them and can't be bought. A viewer without
// the card is offered the card itself first.

import type { LoadoutItem } from "../../components/card/LoadoutItems";

export {
  type LoadoutItem,
  loadoutItems,
} from "../../components/card/LoadoutItems";

const PLACEMENT: StorePlacement = { kind: "card_loadout" };

interface ShownPrices {
  priceHard: number | null;
  priceSoft: number | null;
  listPriceHard: number | null;
  listPriceSoft: number | null;
}

/**
 * An item's prices as the Store shows them now (currentPrice): while its own
 * sale runs, the sale price with the list price to strike through; once the
 * sale has ended, the list price alone. Read at render, as a look saved
 * mid-game is shown minutes later.
 */
// TODO(merge): shownPrice — switch to W1's ShownPrice.ts when the branches
// merge.
export function shownPrices(entry: LoadoutItem): ShownPrices {
  const item = entry.item as Parameters<typeof currentPrice>[0];
  const ended = saleHasEnded(item);
  const price = (currency: "hard" | "soft", fallback: number | undefined) => {
    const now = currentPrice(item, currency);
    return now !== undefined && now > 0 ? now : (fallback ?? null);
  };
  const priceHard = price("hard", entry.priceHard);
  const priceSoft = price("soft", entry.priceSoft);
  return {
    priceHard,
    priceSoft,
    listPriceHard:
      priceHard !== null && !ended ? (item.listPriceHard ?? null) : null,
    listPriceSoft:
      priceSoft !== null && !ended ? (item.listPriceSoft ?? null) : null,
  };
}

export interface PromoInput {
  isWin: boolean;
  gamesPlayed: number;
  inIframe: boolean;
  canWishlist: boolean;
  rand: number;
  // The loadout has something to buy.
  hasLoadout: boolean;
  // This is the eliminated-by screen with a card on it.
  eliminatedByCard: boolean;
}

export type PromoChoice =
  | "tutorial"
  | "steam"
  | "discord"
  | "loadout"
  | "skins";

// The end screen's promo box, as before, except that the store-skins turn
// goes to "Get {name}'s look" on an eliminated-by screen with something to
// buy.
export function promoChoice(p: PromoInput): PromoChoice {
  if (p.inIframe) return p.canWishlist ? "steam" : "discord";
  if (!p.isWin && p.gamesPlayed < 3) return "tutorial";
  if (p.rand < 0.25 && p.canWishlist) return "steam";
  if (p.rand < 0.5) return "discord";
  return p.eliminatedByCard && p.hasLoadout ? "loadout" : "skins";
}

// The part of StoreTracker the row uses (a test passes its own).
export interface LoadoutTracker {
  observe(el: Element, key: string, placement: StorePlacement): void;
  click(key: string, placement: StorePlacement): void;
  releaseDetached(): void;
  dispose(): void;
}

@customElement("loadout-row")
export class LoadoutRow extends LitElement {
  @property({ type: String }) ownerName = "";
  @property({ attribute: false }) items: LoadoutItem[] = [];
  @property({ attribute: false }) tracker: LoadoutTracker | null = null;
  // On a phone the row starts collapsed to one line; tapping opens it.
  @state() private open = false;
  private ownTracker = false;

  createRenderRoot() {
    return this;
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    if (this.tracker === null && typeof IntersectionObserver !== "undefined") {
      const { StoreTracker } = await import("../../StoreTracking");
      this.tracker = new StoreTracker();
      this.ownTracker = true;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.ownTracker) this.tracker?.dispose();
  }

  protected updated(): void {
    const tracker = this.tracker;
    if (tracker === null) return;
    for (const el of this.querySelectorAll<HTMLElement>(
      "[data-loadout-item]",
    )) {
      tracker.observe(el, el.dataset.loadoutItem!, PLACEMENT);
    }
    tracker.releaseDetached();
  }

  private resolved(entry: LoadoutItem): ResolvedCosmetic {
    return {
      type: entry.type,
      cosmetic: entry.item,
      colorPalette: null,
      relationship: "purchasable",
      key: `${entry.type}:${entry.item.name}`,
    };
  }

  private buy(entry: LoadoutItem, method: "hard" | "soft") {
    const key = `${entry.type}:${entry.item.name}`;
    this.tracker?.click(key, PLACEMENT);
    return purchaseCosmetic(this.resolved(entry), method, PLACEMENT);
  }

  private renderItem(entry: LoadoutItem): TemplateResult {
    const prices = shownPrices(entry);
    const key = `${entry.type}:${entry.item.name}`;
    return html`<div
      data-loadout-item=${key}
      data-cosmetic-shell
      data-cosmetic-rarity=${String(entry.item.rarity)}
      class="flex w-40 flex-col gap-1.5 rounded-xl border-2 p-2 text-left text-white"
    >
      <span class="text-[10px] font-bold uppercase tracking-wider text-white/50"
        >${translateText(`win_modal.loadout_type_${entry.type}`)}</span
      >
      <span class="truncate text-sm font-bold"
        >${cardItemName(entry.type, entry.item)}</span
      >
      ${
        entry.state === "buy"
          ? html`<purchase-button
              .priceHard=${prices.priceHard}
              .priceSoft=${prices.priceSoft}
              .listPriceHard=${prices.listPriceHard}
              .listPriceSoft=${prices.listPriceSoft}
              .rarity=${String(entry.item.rarity)}
              .itemName=${cardItemName(entry.type, entry.item)}
              .onPurchaseHard=${() => this.buy(entry, "hard")}
              .onPurchaseSoft=${() => this.buy(entry, "soft")}
            ></purchase-button>`
          : html`<span
              class="rounded-md border border-dashed border-white/30 py-1 text-center text-xs font-bold text-white/70"
              >🔒 ${entry.unlockLabel}</span
            >`
      }
    </div>`;
  }

  render() {
    if (this.items.length === 0) return nothing;
    const title = translateText("win_modal.get_look", { name: this.ownerName });
    return html`<div
      data-loadout-row
      class="mb-6 rounded-sm bg-black/30 p-2.5 text-center"
    >
      <button
        type="button"
        class="flex w-full items-center justify-between text-sm font-bold text-white sm:hidden"
        @click=${() => (this.open = !this.open)}
      >
        <span>${title}</span>
        <span class="text-white/60"
          >${translateText("win_modal.get_look_items", {
            n: this.items.length,
          })}
          ›</span
        >
      </button>
      <h3
        data-loadout-title
        class="mb-3 hidden text-xl font-semibold text-white sm:block"
      >
        ${title}
      </h3>
      <div
        class="${this.open ? "mt-3 flex" : "hidden"} flex-wrap justify-center gap-3 sm:flex"
      >
        ${this.items.map((i) => this.renderItem(i))}
      </div>
    </div>`;
  }
}
