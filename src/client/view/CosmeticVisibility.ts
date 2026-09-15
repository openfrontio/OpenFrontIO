import { effectTypeForSlot } from "../../core/CosmeticSchemas";
import type { PlayerCosmetics } from "../../core/Schemas";
import type { GraphicsOverrides } from "../render/gl/GraphicsOverrides";

export type CosmeticVisibility = NonNullable<GraphicsOverrides["cosmetics"]>;

/** How a cosmetic's owner relates to the local player. */
export type CosmeticOwner = "self" | "teammate" | "other";

/**
 * The part of a player's equipped cosmetics this client draws. Your own
 * cosmetics are always drawn; anyone else's are limited first by whose
 * cosmetics the player chose to see, then by the per-category toggles.
 */
export function visibleCosmetics(
  cosmetics: PlayerCosmetics,
  visibility: CosmeticVisibility,
  owner: CosmeticOwner,
): PlayerCosmetics {
  if (owner === "self") return cosmetics;
  const showFrom = visibility.showFrom ?? "everyone";
  if (
    showFrom === "self" ||
    (showFrom === "teammates" && owner !== "teammate")
  ) {
    // The verified badge marks the account, it isn't a cosmetic.
    return { verified: cosmetics.verified };
  }

  const visible: PlayerCosmetics = { ...cosmetics };
  if (visibility.territorySkins === false) {
    delete visible.pattern;
    delete visible.skin;
  }
  if (visibility.territoryColors === false) delete visible.color;
  if (visibility.flags === false) delete visible.flag;
  if (visibility.crowns === false) delete visible.crown;
  if (cosmetics.effects !== undefined) {
    visible.effects = Object.fromEntries(
      Object.entries(cosmetics.effects).filter(([slot]) => {
        const effectType = effectTypeForSlot(slot);
        return effectType === undefined || visibility[effectType] !== false;
      }),
    );
  }
  return visible;
}
