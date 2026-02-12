import { PublicGameModifiers } from "../core/game/Game";

export function isSpecialModifiers(
  modifiers: PublicGameModifiers | undefined,
): boolean {
  if (!modifiers) {
    return false;
  }

  return Boolean(
    modifiers.isCompact ||
      modifiers.isRandomSpawn ||
      modifiers.isCrowded ||
      modifiers.startingGold !== undefined,
  );
}
