import { Pack } from "../../core/CosmeticSchemas";
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
  if (resolved.type === "pack") {
    return (cosmetic as Pack).displayName;
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
