import {
  type Cosmetics,
  ownsPlayerCard,
} from "@openfront/shared/CosmeticSchemas";
import {
  type CardItem,
  type CardItemType,
  isOfferedCardItem,
} from "./CardItems";
import type { PlayerCardView } from "./PlayerCardModel";

// What "Get {name}'s look" offers from a player's card: on the end screen's
// loadout row (LoadoutRow) and for a look saved from the player panel
// (SavedLooks). Pure, so the panel can build a look without the purchase UI.

export interface LoadoutItem {
  type: CardItemType;
  item: CardItem;
  state: "buy" | "earned";
  unlockLabel?: string;
}

// At most this many items in one end-screen row. Applied there
// (endScreenLookRows), after the ownership, dedupe and card-in-first-row
// filters, so a saved look keeps every candidate.
export const MAX_LOOK_ITEMS = 3;

function toItem(type: CardItemType, item: CardItem): LoadoutItem | null {
  const unlock =
    "unlockSource" in item && item.unlockSource ? item.unlockSource : undefined;
  if (unlock !== undefined) {
    return { type, item, state: "earned", unlockLabel: unlock.label };
  }
  // Priced from the item where shown (LoadoutRow's shownPrices), so a saved
  // look holds no price snapshot to go stale.
  if ((item.priceHard ?? 0) <= 0 && (item.priceSoft ?? 0) <= 0) return null;
  return { type, item, state: "buy" };
}

/**
 * What to offer from `view` (the killer's card): the card itself if the
 * viewer lacks it, then the killer's background and trackers (titles and
 * taunts are held back). Every candidate, in that order:
 * the end screen caps each row (endScreenLookRows).
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
  for (const t of view.trackers) {
    candidates.push(["cardTracker", cosmetics?.cardTrackers?.[t.stat]]);
  }
  const out: LoadoutItem[] = [];
  for (const [type, item] of candidates) {
    if (item === undefined || !isOfferedCardItem(type, item)) continue;
    if (owned.has(`${type}:${item.name}`)) continue;
    const entry = toItem(type, item);
    if (entry !== null) out.push(entry);
  }
  return out;
}
