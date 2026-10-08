import { Progress } from "@openfront/shared/ApiSchemas";
import { LevelBadge, packLevelBadge } from "@openfront/shared/LevelBadgeWire";

// The roster's level badge for a joining player, from the `player` of the game
// server's own /users/@me lookup — never from anything the client sent. No
// badge when the player chose to hide their level (`levelHidden`); an API
// without the setting omits the field, which reads as shown.
export function levelBadgeForPlayer(player: {
  progress?: Progress;
  levelHidden?: boolean;
}): LevelBadge | undefined {
  if (player.levelHidden === true) return undefined;
  return levelBadgeFromProgress(player.progress);
}

// The badge from a /users/@me `progress`. Undefined (no badge) when there is
// no progress: a guest, the API has progression off, or the field was
// malformed (UserMeResponseSchema already reads a malformed object as absent).
//
// The API types these as plain numbers, but the roster packs them into one
// small integer (packLevelBadge: level 1..100, prestige 0..10), so anything
// it cannot pack drops the badge rather than sending a wrong one.
export function levelBadgeFromProgress(
  progress: Progress | undefined,
): LevelBadge | undefined {
  if (progress === undefined) return undefined;
  const { level, prestige, legend } = progress;
  const badge = { level, prestige, legend };
  return packLevelBadge(badge) === undefined ? undefined : badge;
}
