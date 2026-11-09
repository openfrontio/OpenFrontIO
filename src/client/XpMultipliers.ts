// The last step of the API's XP formula (ProvisionalXp.ts): both
// multipliers, rounded once, half up. Its own module so the homepage can
// work out a game's first-game bonus exactly (ProvisionalProgress.ts)
// without loading the formula.
export function applyMultipliers(
  subtotal: number,
  gamePermille: number,
  subscriberPermille: number,
): number {
  const scale = 1000 * 1000;
  return Math.floor(
    (subtotal * gamePermille * subscriberPermille + scale / 2) / scale,
  );
}
