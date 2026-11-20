import {
  type Cosmetics,
  ownsPlayerCard,
} from "@openfront/shared/CosmeticSchemas";
import {
  type CardItem,
  type CardItemType,
  isOfferedCardItem,
} from "./CardItems";
import { CARD_TAUNTS_ENABLED, CARD_TITLES_ENABLED } from "./HeldBack";
import type { PlayerCardView } from "./PlayerCardModel";

// What "Get {name}'s look" offers from a player's card: on the end screen's
// loadout row (LoadoutRow) and for a look saved from the player panel
// (SavedLooks). Pure, so the panel can build a look without the purchase UI.

export interface LoadoutItem {
  type: CardItemType;
  item: CardItem;
  state: "buy" | "earned";
  priceHard?: number;
  priceSoft?: number;
  unlockLabel?: string;
}

const MAX_ITEMS = 3;

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
 * viewer lacks it, then background, taunt and title (only while switched on
 * in HeldBack.ts) and the killer's trackers.
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
  if (view.title && CARD_TITLES_ENABLED) {
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
    if (item === undefined || !isOfferedCardItem(type, item)) continue;
    if (owned.has(`${type}:${item.name}`)) continue;
    const entry = toItem(type, item);
    if (entry !== null) out.push(entry);
  }
  return out;
}
