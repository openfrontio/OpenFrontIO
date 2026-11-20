import type { StorePlacement } from "@openfront/shared/ApiSchemas";
import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { purchaseCosmetic, type ResolvedCosmetic } from "../../Cosmetics";
import { translateText } from "../../Utils";
import "../CosmeticCard";
import "../PurchaseButton";
import {
  type CardItem,
  type CardItemType,
  cardItemName,
  cardOwnershipKey,
  cardPrices,
} from "./CardItems";
import { CARD_TAUNTS_ENABLED, CARD_TITLES_ENABLED } from "./HeldBack";
import "./PlayerCard";
import { buildPlayerCardView } from "./PlayerCardModel";

// The store's Card sub-tab: every player card item that is sold, the card
// itself first, then trackers and backgrounds (titles and taunts too, once
// switched back on in HeldBack.ts). Earned items
// aren't listed (they're never sold). Prices in Plutonium and/or caps,
// bought through the store's purchase flow.

const PLACEMENT: StorePlacement = {
  kind: "tab",
  tab: "cosmetics",
  subTab: "card",
};

const SECTIONS: [keyof Cosmetics, CardItemType][] = [
  ["playerCards", "playerCard"],
  ["cardTrackers", "cardTracker"],
  ["cardBackgrounds", "cardBackground"],
  ["cardTitles", "cardTitle"],
  ["taunts", "taunt"],
];

export interface CardStoreTracker {
  observe(el: Element, key: string, placement: StorePlacement): void;
  click(key: string, placement: StorePlacement): void;
  releaseDetached(): void;
}

function isSold(item: CardItem): boolean {
  if ("unlockSource" in item && item.unlockSource) return false;
  return (item.priceHard ?? 0) > 0 || (item.priceSoft ?? 0) > 0;
}

// The sold card items, in the tab's order.
export function cardStoreItems(
  cosmetics: Cosmetics | null,
): { type: CardItemType; item: CardItem }[] {
  const out: { type: CardItemType; item: CardItem }[] = [];
  for (const [key, type] of SECTIONS) {
    if (type === "taunt" && !CARD_TAUNTS_ENABLED) continue;
    if (type === "cardTitle" && !CARD_TITLES_ENABLED) continue;
    const section = (cosmetics?.[key] ?? {}) as Record<string, CardItem>;
    for (const item of Object.values(section)) {
      if (isSold(item)) out.push({ type, item });
    }
  }
  return out;
}

@customElement("card-store-grid")
export class CardStoreGrid extends LitElement {
  @property({ attribute: false }) cosmetics: Cosmetics | null = null;
  @property({ attribute: false }) flares: readonly string[] = [];
  @property({ attribute: false }) tracker: CardStoreTracker | null = null;

  createRenderRoot() {
    return this;
  }

  protected updated(): void {
    const tracker = this.tracker;
    if (tracker === null) return;
    for (const el of this.querySelectorAll<HTMLElement>(
      "[data-card-store-item]",
    )) {
      tracker.observe(el, el.dataset.cardStoreItem!, PLACEMENT);
    }
    tracker.releaseDetached();
  }

  private buy(type: CardItemType, item: CardItem, method: "hard" | "soft") {
    this.tracker?.click(`${type}:${item.name}`, PLACEMENT);
    const resolved: ResolvedCosmetic = {
      type,
      cosmetic: item,
      colorPalette: null,
      relationship: "purchasable",
      key: `${type}:${item.name}`,
    };
    return purchaseCosmetic(resolved, method, PLACEMENT);
  }

  private preview(type: CardItemType, item: CardItem): TemplateResult {
    if (type === "cardBackground") {
      return html`<player-card
        size="thumb"
        .view=${buildPlayerCardView(
          {
            username: "",
            clanTag: null,
            badge: null,
            card: { background: item.name, trackers: [] },
          },
          this.cosmetics,
        )}
      ></player-card>`;
    }
    return html`<div
      class="grid h-16 w-40 place-items-center rounded-lg bg-black/30 px-2 text-center text-sm font-bold"
    >
      ${cardItemName(type, item)}
    </div>`;
  }

  render() {
    const items = cardStoreItems(this.cosmetics);
    if (items.length === 0) {
      return html`<p class="p-6 text-center text-white/60">
        ${translateText("store.no_card_items")}
      </p>`;
    }
    const owned = new Set(this.flares);
    return html`<div class="flex flex-wrap justify-center gap-3 p-3">
      ${items.map(({ type, item }) => {
        const key = `${type}:${item.name}`;
        const prices = cardPrices(item);
        return html`<div
          data-card-store-item=${key}
          data-cosmetic-shell
          data-cosmetic-rarity=${String(item.rarity)}
          class="flex w-44 flex-col gap-1.5 rounded-xl border-2 p-2 text-white"
        >
          ${this.preview(type, item)}
          <span
            class="text-[10px] font-bold uppercase tracking-wider text-white/50"
            >${translateText(`win_modal.loadout_type_${type}`)}</span
          >
          <span class="truncate text-sm font-bold"
            >${cardItemName(type, item)}</span
          >
          ${
            owned.has(cardOwnershipKey(type, item))
              ? html`<span
                  class="rounded-md bg-white/10 py-1 text-center text-xs font-bold"
                  >${translateText("my_card.owned")}</span
                >`
              : html`<purchase-button
                  .priceHard=${prices.priceHard}
                  .priceSoft=${prices.priceSoft}
                  .listPriceHard=${prices.listPriceHard}
                  .listPriceSoft=${prices.listPriceSoft}
                  .rarity=${String(item.rarity)}
                  .itemName=${cardItemName(type, item)}
                  .onPurchaseHard=${() => this.buy(type, item, "hard")}
                  .onPurchaseSoft=${() => this.buy(type, item, "soft")}
                ></purchase-button>`
          }
        </div>`;
      })}
      ${nothing}
    </div>`;
  }
}
