import {
  type CardBackground,
  type CardTitle,
  type CardTracker,
  cardTrackerNamedByStat,
  type PlayerCardItem,
  type Taunt,
} from "@openfront/shared/CosmeticSchemas";
import { currentPrice, saleHasEnded } from "../../SalePrice";
import { translateText } from "../../Utils";

// The player card cosmetics, as the client lists and sells them.

export const CARD_ITEM_TYPES = [
  "playerCard",
  "cardTracker",
  "cardBackground",
  "cardTitle",
  "taunt",
] as const;
export type CardItemType = (typeof CARD_ITEM_TYPES)[number];

export type CardItem =
  | PlayerCardItem
  | CardTracker
  | CardBackground
  | CardTitle
  | Taunt;

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

export interface CardPrices {
  priceHard: number | null;
  priceSoft: number | null;
  listPriceHard: number | null;
  listPriceSoft: number | null;
}

// A card item's prices as the server charges them now, for <purchase-button>:
// once the item's own sale has ended that is the list price, with nothing
// struck through, whatever the catalogue in hand says. Same rule as the store.
export function cardPrices(item: CardItem): CardPrices {
  const ended = saleHasEnded(item);
  return {
    priceHard: currentPrice(item, "hard") ?? null,
    priceSoft: currentPrice(item, "soft") ?? null,
    listPriceHard: ended ? null : (item.listPriceHard ?? null),
    listPriceSoft: ended ? null : (item.listPriceSoft ?? null),
  };
}

// A card item's rarity as a word, in the player's language. The card has a
// 1 of 1 tier the other cosmetics don't; anything unknown reads as Common.
export function cardRarityLabel(rarity: string): string {
  switch (rarity) {
    case "uncommon":
      return translateText("cosmetics.uncommon");
    case "rare":
      return translateText("cosmetics.rare");
    case "epic":
      return translateText("cosmetics.epic");
    case "legendary":
      return translateText("cosmetics.legendary");
    case "oneofone":
      return translateText("cosmetics.oneofone");
    default:
      return translateText("cosmetics.common");
  }
}

// Whether a card item may be offered at all: a tracker only when its name
// is its stat (cardTrackerNamedByStat). Ownership is then `<type>:<name>`,
// the flare the shop grants.
export function isOfferedCardItem(type: CardItemType, item: CardItem): boolean {
  return type !== "cardTracker" || cardTrackerNamedByStat(item as CardTracker);
}
