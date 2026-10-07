import { PlayerCosmetics, PlayerPattern } from "../core/Schemas";
import { ResolvedCosmetic } from "./Cosmetics";

export type EquippedCosmeticType = "pattern" | "skin" | "crown" | "effect";

export type EquippedCosmetic = {
  type: EquippedCosmeticType;
  /** Catalog key, same format `resolveCosmetics` produces. */
  key: string;
  name: string;
  /** Catalog entry, or null when the catalog isn't loaded or dropped the item. */
  resolved: ResolvedCosmetic | null;
  /** Patterns only — taken from the player, so it renders without the catalog. */
  pattern: PlayerPattern | null;
  /** Skins and crowns only. */
  imageUrl: string | null;
  /** "unknown" when the item isn't in the catalog, so no store link is offered. */
  relationship: ResolvedCosmetic["relationship"] | "unknown";
};

function keyForEquippedPattern(pattern: PlayerPattern): string {
  return pattern.colorPalette
    ? `pattern:${pattern.name}:${pattern.colorPalette.name}`
    : `pattern:${pattern.name}`;
}

/**
 * The cosmetics a player has equipped, paired with the viewer's catalog so the
 * UI knows whether the viewer already owns each one. Flags are left out: the
 * panel already shows the flag, and nation flags aren't store items.
 */
export function equippedCosmetics(
  cosmetics: PlayerCosmetics,
  catalog: ResolvedCosmetic[],
): EquippedCosmetic[] {
  const byKey = new Map(catalog.map((r) => [r.key, r]));
  // the catalog keys effects by their map key, which need not equal the
  // effect's name, so match on effectType plus the name both sides carry
  const effectByName = new Map(
    catalog
      .filter((r) => r.type === "effect")
      .map((r) => [`${r.effectType}:${r.cosmetic?.name}`, r]),
  );
  const equipped: EquippedCosmetic[] = [];

  const add = (
    type: EquippedCosmeticType,
    key: string,
    name: string,
    pattern: PlayerPattern | null,
    imageUrl: string | null,
  ) => {
    const resolved = byKey.get(key) ?? null;
    equipped.push({
      type,
      key,
      name,
      resolved,
      pattern,
      imageUrl,
      relationship: resolved?.relationship ?? "unknown",
    });
  };

  if (cosmetics.pattern) {
    add(
      "pattern",
      keyForEquippedPattern(cosmetics.pattern),
      cosmetics.pattern.name,
      cosmetics.pattern,
      null,
    );
  }
  if (cosmetics.skin) {
    add(
      "skin",
      `skin:${cosmetics.skin.name}`,
      cosmetics.skin.name,
      null,
      cosmetics.skin.url,
    );
  }
  if (cosmetics.crown) {
    add(
      "crown",
      `crown:${cosmetics.crown.name}`,
      cosmetics.crown.name,
      null,
      cosmetics.crown.url,
    );
  }
  for (const effect of Object.values(cosmetics.effects ?? {})) {
    const resolved =
      effectByName.get(`${effect.effectType}:${effect.name}`) ?? null;
    add(
      "effect",
      resolved?.key ?? `effect:${effect.effectType}:${effect.name}`,
      effect.name,
      null,
      null,
    );
  }

  return equipped;
}

/**
 * Hash route that opens the store on the item, for `ModalRouter`. Effects only
 * get their tab — the effects grid has no per-item target.
 */
export function storeRouteFor(equipped: EquippedCosmetic): string | null {
  if (equipped.relationship !== "purchasable") return null;
  if (equipped.type === "effect") {
    return "#modal=store&tab=effects";
  }
  return `#modal=store&tab=cosmetics&item=${encodeURIComponent(equipped.key)}`;
}

/**
 * Whether a catalog key is the item a store deep link asked for. Pattern
 * palette variants collapse into one store tile, so any variant of the
 * requested pattern matches.
 */
export function matchesStoreItem(key: string, wanted: string): boolean {
  if (key === wanted) return true;
  if (!key.startsWith("pattern:") || !wanted.startsWith("pattern:")) {
    return false;
  }
  return key.split(":")[1] === wanted.split(":")[1];
}
