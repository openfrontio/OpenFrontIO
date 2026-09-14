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

/**
 * What kind of cosmetic this is, as shown to players ("Skin", "Flag",
 * "Boat Trail Effect", …). Patterns are "Skins" throughout the store.
 */
export function cosmeticTypeLabel(resolved: ResolvedCosmetic): string {
  switch (resolved.type) {
    case "pattern":
    case "skin":
      return translateText("cosmetics.type_skin");
    case "flag":
      return translateText("cosmetics.type_flag");
    case "crown":
      return translateText("cosmetics.type_crown");
    case "effect":
      return translateText("cosmetics.type_effect", {
        type: translateText(`effects.type.${resolved.effectType}`),
      });
    default:
      return "";
  }
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

const RARITY_BADGE_CLASSES: Record<string, string> = {
  common: "bg-white/10 text-white/80 border-white/20",
  uncommon: "bg-green-500/15 text-green-300 border-green-400/40",
  rare: "bg-blue-500/15 text-blue-300 border-blue-400/40",
  epic: "bg-purple-500/15 text-purple-300 border-purple-400/40",
  legendary: "bg-orange-500/15 text-orange-300 border-orange-400/40",
};

/** Tailwind classes for a rarity pill, tinted by tier (matches CosmeticInfo's text colors). */
export function cosmeticRarityBadgeClass(resolved: ResolvedCosmetic): string {
  return (
    RARITY_BADGE_CLASSES[cosmeticRarity(resolved)] ??
    RARITY_BADGE_CLASSES.common
  );
}
