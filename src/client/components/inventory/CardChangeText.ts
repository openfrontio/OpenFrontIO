import type { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { translateText } from "../../Utils";
import { cardItemName } from "../card/CardItems";
import {
  type CardChange,
  type CardSlotRef,
  isSingleSlot,
  slotItem,
} from "./CardDraft";

// How the Player card tab, its Save bar and the unsaved-changes guard name
// slots, items and changes.

/** An item in a slot by name; "None" / "Empty" for nothing. */
export function cardSlotItemName(
  cosmetics: Cosmetics | null,
  slot: CardSlotRef,
  name: string | null,
): string {
  if (name === null) {
    return translateText(
      slot.kind === "background"
        ? "inventory_card.background_none"
        : slot.kind === "title"
          ? "inventory_card.title_none"
          : "inventory_card.empty_slot",
    );
  }
  const found = slotItem(cosmetics, slot, name);
  if (found !== null) return cardItemName(found.type, found.item);
  // A saved title the catalogue no longer has shows as none: the card
  // doesn't show it either.
  if (slot.kind === "title") return translateText("inventory_card.title_none");
  if (slot.kind === "tracker") {
    return translateText(`player_card.tracker_${name}`);
  }
  return name;
}

/** "Background", "Title", "Tracker 3". */
export function cardSlotLabel(slot: CardSlotRef): string {
  return isSingleSlot(slot)
    ? translateText(`inventory_card.${slot.kind}`)
    : translateText(`inventory_card.slot_${slot.kind}`, {
        slot: slot.index + 1,
      });
}

/** "Tracker 3: Best Elo → Games played". */
export function cardChangeLine(
  cosmetics: Cosmetics | null,
  change: CardChange,
): string {
  return translateText("inventory_card.change_line", {
    slot: cardSlotLabel(change.slot),
    from: cardSlotItemName(cosmetics, change.slot, change.from),
    to: cardSlotItemName(cosmetics, change.slot, change.to),
  });
}
