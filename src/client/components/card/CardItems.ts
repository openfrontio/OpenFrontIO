import type {
  CardBackground,
  CardTitle,
  CardTracker,
  PlayerCardItem,
  Taunt,
} from "@openfront/shared/CosmeticSchemas";
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
  return text === key ? item.name : text;
}
