import {
  type CardBackground,
  type CardTitle,
  type CardTracker,
  cardTrackerNamedByStat,
  type Cosmetics,
  type PlayerCardItem,
} from "@openfront/shared/CosmeticSchemas";
import { translateText } from "../../Translate";

// The player card cosmetics, as the client lists and sells them. Taunts are
// held back: their schema and catalogue entries stay, but the client neither
// lists nor sells them.

export const CARD_ITEM_TYPES = [
  "playerCard",
  "cardTracker",
  "cardBackground",
  "cardTitle",
] as const;
export type CardItemType = (typeof CARD_ITEM_TYPES)[number];

// Where each card item type lives in the catalogue. The one copy: the Store
// grid and the end screen's price lookup both read it.
export const CARD_ITEM_GROUP = {
  playerCard: "playerCards",
  cardTracker: "cardTrackers",
  cardBackground: "cardBackgrounds",
  cardTitle: "cardTitles",
} as const satisfies Record<CardItemType, keyof Cosmetics>;

export type CardItem =
  | PlayerCardItem
  | CardTracker
  | CardBackground
  | CardTitle;

export function isCardItemType(type: string): type is CardItemType {
  return (CARD_ITEM_TYPES as readonly string[]).includes(type);
}

// The name a card item goes by in the UI: a title's own text, a tracker's
// stat label, otherwise its translated name (falling back to the raw name).
export function cardItemName(type: CardItemType, item: CardItem): string {
  if (type === "cardTitle") return (item as CardTitle).text;
  if (type === "cardTracker") {
    return translateText(`player_card.tracker_${(item as CardTracker).stat}`);
  }
  if (type === "playerCard") return translateText("player_card.the_card");
  const key = `player_card.items.${item.name}`;
  const text = translateText(key);
  return text === key ? readableName(item.name) : text;
}

// "bg_neon_grid" → "Neon Grid": the name as words, for an item with no
// translation yet.
function readableName(name: string): string {
  return name
    .replace(/^bg_/, "")
    .split("_")
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Whether a card item may be offered at all: a tracker only when its name
// is its stat (cardTrackerNamedByStat). Ownership is then `<type>:<name>`,
// the flare the shop grants.
export function isOfferedCardItem(type: CardItemType, item: CardItem): boolean {
  return type !== "cardTracker" || cardTrackerNamedByStat(item as CardTracker);
}
