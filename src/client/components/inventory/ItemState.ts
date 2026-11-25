import type { ResolvedCosmetic } from "../../Cosmetics";
import { cosmeticRarity } from "../CosmeticPresentation";

/**
 * What an item is to the player, shown in its tile's footer (both Inventory
 * tabs). Text, never colour alone:
 * - equipped: in use. Solid blue "✓ Equipped" footer and a corner check.
 * - unsaved: Player card tab only. Picked but not saved yet.
 * - owned: theirs, not in use.
 * - earned: can't be bought; the tile says how to unlock it.
 * - forSale: a price chip per currency.
 */
export type ItemState = "equipped" | "unsaved" | "owned" | "earned" | "forSale";

/** How to unlock an earned-only item, e.g. "Season 1 · free tier 20". */
export function unlockLabel(resolved: ResolvedCosmetic): string | null {
  const source = (
    resolved.cosmetic as { unlockSource?: { label?: unknown } } | null
  )?.unlockSource;
  return typeof source?.label === "string" && source.label !== ""
    ? source.label
    : null;
}

/**
 * The tile state for an item, or null when the Inventory doesn't show it at
 * all (not owned, not for sale and no way to earn it, e.g. another creator's
 * item).
 */
export function itemStateOf(
  resolved: ResolvedCosmetic,
  equipped: boolean,
): ItemState | null {
  if (resolved.relationship === "owned") return equipped ? "equipped" : "owned";
  if (unlockLabel(resolved) !== null) return "earned";
  if (resolved.relationship === "purchasable") return "forSale";
  return null;
}

const RARITY_RANK: Record<string, number> = {
  legendary: 0,
  oneofone: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

const STATE_RANK: Record<ItemState, number> = {
  equipped: 0,
  unsaved: 0,
  owned: 1,
  forSale: 2,
  earned: 2,
};

/** Grid order: equipped first, then owned, then rarity (rarest first). */
export function compareTiles(
  a: { resolved: ResolvedCosmetic; state: ItemState },
  b: { resolved: ResolvedCosmetic; state: ItemState },
): number {
  return (
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    (RARITY_RANK[cosmeticRarity(a.resolved)] ?? 4) -
      (RARITY_RANK[cosmeticRarity(b.resolved)] ?? 4)
  );
}
