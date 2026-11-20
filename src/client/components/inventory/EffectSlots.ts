import {
  EFFECT_TYPES,
  NUKE_EXPLOSION_TYPES,
} from "@openfront/shared/CosmeticSchemas";

/**
 * Every effect selection slot, in list order: one per effect type, except
 * nuke explosions, which a player picks per bomb. Same slots as
 * UserSettings' selected effects (see effectTypeForSlot).
 */
export const EFFECT_SLOTS: readonly string[] = EFFECT_TYPES.flatMap((type) =>
  type === "nukeExplosion" ? [...NUKE_EXPLOSION_TYPES] : [type],
);
