import { effectTypeForSlot } from "@openfront/shared/CosmeticSchemas";
import type { PlayerCosmetics } from "@openfront/shared/WireSchemas";
import type { GraphicsOverrides } from "../render/gl/GraphicsOverrides";

export type CosmeticVisibility = NonNullable<GraphicsOverrides["cosmetics"]>;

/** How a cosmetic's owner relates to the local player. */
export type CosmeticOwner = "self" | "teammate" | "other";

/**
 * The part of a player's equipped cosmetics this client draws. None hides
 * everyone's cosmetics; otherwise your own are always drawn and other
 * players' cosmetics are limited by the owner and per-category toggles.
 */
export function visibleCosmetics(
  cosmetics: PlayerCosmetics,
  visibility: CosmeticVisibility,
  owner: CosmeticOwner,
): PlayerCosmetics {
  const showFrom = visibility.showFrom ?? "everyone";
  if (showFrom === "none") return { verified: cosmetics.verified };
  if (owner === "self") return cosmetics;
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
