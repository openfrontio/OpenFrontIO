import { CosmeticPack, Pack } from "../../core/CosmeticSchemas";
import { ResolvedCosmetic, translateCosmetic } from "../Cosmetics";
import { translateText } from "../Utils";

export function cosmeticDisplayName(resolved: ResolvedCosmetic): string {
  const cosmetic = resolved.cosmetic;
  if (cosmetic === null) {
    if (resolved.type === "crown" || resolved.type === "flag") {
      return translateText("common.none");
    }
    return translateText("territory_patterns.pattern.default");
  }
  if (resolved.type === "flag" && resolved.key === "country:xx") {
    return translateText("common.none");
  }
  if (resolved.type === "pattern" || resolved.type === "skin") {
    return translateCosmetic("territory_patterns.pattern", cosmetic.name);
  }
  if (resolved.type === "pack" || resolved.type === "cosmeticPack") {
    return (cosmetic as Pack | CosmeticPack).displayName;
  }
  if (resolved.type === "subscription") {
    return translateCosmetic("subscriptions", cosmetic.name);
  }
  if (resolved.type === "effect") {
    return translateCosmetic("effects", cosmetic.name);
  }
  if (resolved.type === "crown") {
    return translateCosmetic("crowns", cosmetic.name);
  }
  return translateCosmetic("flags", cosmetic.name);
}

/**
 * The item's name, qualified by its colour when it has one — a pattern is only
 * identifiable as "Ocean Stripes (Crimson)", since every palette of it shares
 * the one name.
 */
export function cosmeticSelectionLabel(resolved: ResolvedCosmetic): string {
  const name = cosmeticDisplayName(resolved);
  const palette = resolved.colorPalette;
  if (palette === null || resolved.cosmetic === null) return name;
  return translateText("inventory.selected_cosmetic_variant", {
    name,
    variant: translateCosmetic(
      "territory_patterns.color_palette",
      palette.name,
    ),
  });
}

export function cosmeticRarity(resolved: ResolvedCosmetic): string {
  return resolved.cosmetic?.rarity ?? "common";
}

export function cosmeticRarityLabel(resolved: ResolvedCosmetic): string {
  switch (cosmeticRarity(resolved)) {
    case "uncommon":
      return translateText("cosmetics.uncommon");
    case "rare":
      return translateText("cosmetics.rare");
    case "epic":
      return translateText("cosmetics.epic");
    case "legendary":
      return translateText("cosmetics.legendary");
    default:
      return translateText("cosmetics.common");
  }
}
