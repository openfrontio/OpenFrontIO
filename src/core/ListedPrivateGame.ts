export const LISTED_PRIVATE_GAME_FLARE = "game:*";
export const LISTED_PRIVATE_GAME_TYPE = "listed-private";

export function hasListedPrivateGameFlare(flares: readonly string[]): boolean {
  return true;
  // return flares.includes(LISTED_PRIVATE_GAME_FLARE);
}
