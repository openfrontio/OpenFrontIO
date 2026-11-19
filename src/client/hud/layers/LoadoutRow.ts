import type { StorePlacement } from "@openfront/shared/ApiSchemas";
import {
  type Cosmetics,
  ownsPlayerCard,
} from "@openfront/shared/CosmeticSchemas";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  type CardItem,
  type CardItemType,
  cardItemName,
} from "../../components/card/CardItems";
import { CARD_TAUNTS_ENABLED } from "../../components/card/HeldBack";
import type { PlayerCardView } from "../../components/card/PlayerCardModel";
import "../../components/CosmeticCard";
import "../../components/PurchaseButton";
import { purchaseCosmetic, type ResolvedCosmetic } from "../../Cosmetics";
import { translateText } from "../../Utils";

// "Get {name}'s look": on the eliminated-by screen, up to three things the
// player who eliminated you has on their card, in the promo box's place (the
// store-skins turn). Paid items buy in Plutonium or caps like the store;
// earned ones show how to unlock them and can't be bought. A viewer without
// the card is offered the card itself first.

export interface LoadoutItem {
  type: CardItemType;
  item: CardItem;
  state: "buy" | "earned";
  priceHard?: number;
  priceSoft?: number;
  unlockLabel?: string;
}

const MAX_ITEMS = 3;
const PLACEMENT: StorePlacement = { kind: "card_loadout" };

function toItem(type: CardItemType, item: CardItem): LoadoutItem | null {
  const unlock =
    "unlockSource" in item && item.unlockSource ? item.unlockSource : undefined;
  if (unlock !== undefined) {
    return { type, item, state: "earned", unlockLabel: unlock.label };
  }
  const priceHard = (item.priceHard ?? 0) > 0 ? item.priceHard : undefined;
  const priceSoft = (item.priceSoft ?? 0) > 0 ? item.priceSoft : undefined;
  if (priceHard === undefined && priceSoft === undefined) return null;
  return { type, item, state: "buy", priceHard, priceSoft };
}

/**
 * What to offer from `view` (the killer's card): the card itself if the
 * viewer lacks it, then background, taunt, title and the killer's trackers.
 * Anything the viewer owns, or that is neither sold nor earnable, is skipped.
 */
export function loadoutItems(
  view: PlayerCardView,
  cosmetics: Cosmetics | null,
  viewerFlares: readonly string[],
): LoadoutItem[] {
  const owned = new Set(viewerFlares);
  const candidates: [CardItemType, CardItem | undefined][] = [];
  if (!ownsPlayerCard(viewerFlares)) {
    candidates.push([
      "playerCard",
      Object.values(cosmetics?.playerCards ?? {})[0] as CardItem | undefined,
    ]);
  }
  if (view.background) {
    candidates.push([
      "cardBackground",
      cosmetics?.cardBackgrounds?.[view.background.name],
    ]);
  }
  if (view.taunt && CARD_TAUNTS_ENABLED) {
    candidates.push(["taunt", cosmetics?.taunts?.[view.taunt.name]]);
  }
  if (view.title) {
    const title = Object.values(cosmetics?.cardTitles ?? {}).find(
      (t) => t.text === view.title!.text,
    );
    candidates.push(["cardTitle", title]);
  }
  for (const t of view.trackers) {
    candidates.push(["cardTracker", cosmetics?.cardTrackers?.[t.stat]]);
  }
  const out: LoadoutItem[] = [];
  for (const [type, item] of candidates) {
    if (out.length === MAX_ITEMS) break;
    if (item === undefined || owned.has(`${type}:${item.name}`)) continue;
    const entry = toItem(type, item);
    if (entry !== null) out.push(entry);
  }
  return out;
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
              .priceHard=${entry.priceHard ?? null}
              .priceSoft=${entry.priceSoft ?? null}
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
