import type { StorePlacement } from "@openfront/shared/ApiSchemas";
import {
  type CardTracker,
  type Cosmetics,
  ownsPlayerCard,
} from "@openfront/shared/CosmeticSchemas";
import type { LevelBadge } from "@openfront/shared/LevelBadgeWire";
import {
  html,
  LitElement,
  nothing,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { purchaseCosmetic, type ResolvedCosmetic } from "../../Cosmetics";
import type { PricedItem } from "../../ShownPrice";
import { translateText } from "../../Utils";
import "../CosmeticCard";
import type { PurchaseButton } from "../PurchaseButton";
import "../PurchaseButton";
import {
  CARD_ITEM_GROUP,
  CARD_ITEM_TYPES,
  type CardItem,
  type CardItemType,
  cardItemName,
  isOfferedCardItem,
} from "./CardItems";
import "./CardItemPreview";
import "./PlayerCard";
import { buildPlayerCardView, type PlayerCardView } from "./PlayerCardModel";

// The store's Card sub-tab: every player card item that is sold, the card
// itself first, then trackers and backgrounds (titles and taunts are held
// back). Without the card, its items still sell (the card comes first, as
// in "Get {name}'s look") but each says it needs the card. Earned items
// aren't listed (they're never sold). Prices in Plutonium and/or caps,
// bought through the store's purchase flow. A tile's preview opens a
// large, animated preview of the item on the card.

const PLACEMENT: StorePlacement = {
  kind: "tab",
  tab: "cosmetics",
  subTab: "card",
};

// In CARD_ITEM_TYPES order: card, trackers, backgrounds.
const SECTIONS: [keyof Cosmetics, CardItemType][] = CARD_ITEM_TYPES.map(
  (type) => [CARD_ITEM_GROUP[type], type],
);

// The value a tracker shows in its large preview.
const SAMPLE_TRACKER_VALUE = 1904;

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
    const section = (cosmetics?.[key] ?? {}) as Record<string, CardItem>;
    for (const item of Object.values(section)) {
      if (isSold(item) && isOfferedCardItem(type, item)) {
        out.push({ type, item });
      }
    }
  }
  return out;
}

@customElement("card-store-grid")
export class CardStoreGrid extends LitElement {
  @property({ attribute: false }) cosmetics: Cosmetics | null = null;
  @property({ attribute: false }) flares: readonly string[] = [];
  @property({ attribute: false }) tracker: CardStoreTracker | null = null;
  /** An item a Store link asked for (`<type>:<name>`), e.g. after a top-up
   * from the end screen: once it shows it is selected, scrolled to and its
   * Buy focused, and `requested-item-shown` tells the Store. */
  @property({ attribute: false }) requestedItem: string | null = null;
  /** The viewer's name, for the large preview's card. */
  @property({ attribute: false }) username = "";
  /** And their level badge. */
  @property({ attribute: false }) badge: LevelBadge | null = null;
  @state() private selected: string | null = null;
  /** The item in the large preview. */
  @state() private previewing: { type: CardItemType; item: CardItem } | null =
    null;

  createRenderRoot() {
    return this;
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    // The request was handled: clear the selection, so the same item can be
    // asked for again.
    if (changed.has("requestedItem") && this.requestedItem === null) {
      this.selected = null;
    }
  }

  protected updated(): void {
    this.showRequested();
    const tracker = this.tracker;
    if (tracker === null) return;
    for (const el of this.querySelectorAll<HTMLElement>(
      "[data-card-store-item]",
    )) {
      tracker.observe(el, el.dataset.cardStoreItem!, PLACEMENT);
    }
    tracker.releaseDetached();
  }

  private showRequested(): void {
    const key = this.requestedItem;
    if (key === null || key === this.selected) return;
    const tile = [
      ...this.querySelectorAll<HTMLElement>("[data-card-store-item]"),
    ].find((el) => el.dataset.cardStoreItem === key);
    // The catalogue loads after open: keep asking until the item shows.
    if (tile === undefined) return;
    this.selected = key;
    tile.scrollIntoView({ block: "center" });
    // Once its Buy has rendered: bring the tile into view again (the grid
    // may have grown above it meanwhile) and focus the Buy.
    void this.updateComplete.then(async () => {
      const button = tile.querySelector<PurchaseButton>("purchase-button");
      await button?.updateComplete;
      tile.scrollIntoView({ block: "center" });
      tile
        .querySelector<HTMLButtonElement>(
          "purchase-button button:not([disabled])",
        )
        ?.focus({ preventScroll: true });
    });
    this.dispatchEvent(
      new CustomEvent("requested-item-shown", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  // `shownAmount`: what the confirm box showed; the server refuses (409) to
  // charge more than that.
  private buy(
    type: CardItemType,
    item: CardItem,
    method: "hard" | "soft",
    shownAmount?: number,
  ) {
    this.tracker?.click(`${type}:${item.name}`, PLACEMENT);
    const resolved: ResolvedCosmetic = {
      type,
      cosmetic: item,
      colorPalette: null,
      relationship: "purchasable",
      key: `${type}:${item.name}`,
    };
    return purchaseCosmetic(resolved, method, PLACEMENT, shownAmount);
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

  /** The viewer's card with the previewed item on it. Tracker values are
   * a sample (the Store doesn't know the viewer's stats). */
  private previewView(type: CardItemType, item: CardItem): PlayerCardView {
    return buildPlayerCardView(
      {
        username: this.username,
        clanTag: null,
        badge: this.badge,
        card: {
          background: type === "cardBackground" ? item.name : undefined,
          trackers:
            type === "cardTracker"
              ? [
                  {
                    stat: (item as CardTracker).stat,
                    value: SAMPLE_TRACKER_VALUE,
                  },
                ]
              : [],
        },
      },
      this.cosmetics,
    );
  }

  /** Closes the large preview, if one is open (the Store closing: it hides
   * without removing this grid, and an open preview keeps its Tab trap). */
  closePreview(): void {
    this.previewing = null;
  }

  private renderPreview() {
    const entry = this.previewing;
    if (entry === null) return nothing;
    return html`<card-item-preview
      .entry=${entry}
      .view=${this.previewView(entry.type, entry.item)}
      .note=${
        entry.type === "cardTracker"
          ? translateText("inventory_card.preview_sample")
          : ""
      }
      .onClose=${() => (this.previewing = null)}
    ></card-item-preview>`;
  }

  render() {
    const items = cardStoreItems(this.cosmetics);
    if (items.length === 0) {
      return html`<p class="p-6 text-center text-white/60">
        ${translateText("store.no_card_items")}
      </p>`;
    }
    const owned = new Set(this.flares);
    const hasCard = ownsPlayerCard(this.flares);
    return html`<div class="flex flex-wrap justify-center gap-3 p-3">
      ${items.map(({ type, item }) => {
        const key = `${type}:${item.name}`;
        const selected = this.selected === key;
        return html`<div
          data-card-store-item=${key}
          data-cosmetic-shell
          data-cosmetic-rarity=${String(item.rarity)}
          ?data-card-store-selected=${selected}
          class="flex w-44 flex-col gap-1.5 rounded-xl border-2 p-2 text-white ${
            selected
              ? "ring-4 ring-sky-400 ring-offset-2 ring-offset-black"
              : ""
          }"
        >
          <button
            type="button"
            data-card-store-preview
            aria-label=${translateText("inventory_card.preview", {
              name: cardItemName(type, item),
            })}
            class="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            @click=${() => (this.previewing = { type, item })}
          >
            ${this.preview(type, item)}
          </button>
          <span
            class="text-[10px] font-bold uppercase tracking-wider text-white/50"
            >${translateText(`win_modal.loadout_type_${type}`)}</span
          >
          <span class="truncate text-sm font-bold"
            >${cardItemName(type, item)}</span
          >
          ${
            !hasCard && type !== "playerCard"
              ? html`<span
                  data-card-store-needs-card
                  class="text-[11px] font-bold text-amber-300"
                  >${translateText("store.card_item_needs_card")}</span
                >`
              : nothing
          }
          ${
            owned.has(key)
              ? html`<span
                  class="rounded-md bg-white/10 py-1 text-center text-xs font-bold"
                  >${translateText("my_card.owned")}</span
                >`
              : html`<purchase-button
                  .priceHard=${item.priceHard ?? null}
                  .priceSoft=${item.priceSoft ?? null}
                  .listPriceHard=${item.listPriceHard ?? null}
                  .listPriceSoft=${item.listPriceSoft ?? null}
                  .promotion=${
                    (item as { promotion?: PricedItem["promotion"] })
                      .promotion ?? null
                  }
                  .rarity=${String(item.rarity)}
                  .itemName=${cardItemName(type, item)}
                  .onPurchaseHard=${(shown?: number) =>
                    this.buy(type, item, "hard", shown)}
                  .onPurchaseSoft=${(shown?: number) =>
                    this.buy(type, item, "soft", shown)}
                ></purchase-button>`
          }
        </div>`;
      })}
      ${this.renderPreview()}
    </div>`;
  }
}
