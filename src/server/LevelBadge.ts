import { Progress } from "../core/ApiSchemas";
import { LevelBadge } from "../core/Schemas";

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
// The API types these as plain numbers, but the wire encodes level and
// prestige as unsigned varints, and a value the codec rejects would throw
// out of every lobby_info broadcast for the whole lobby. So anything that is
// not a whole level >= 1 and prestige >= 0 drops the badge instead.
export function levelBadgeFromProgress(
  progress: Progress | undefined,
): LevelBadge | undefined {
  if (progress === undefined) return undefined;
  const { level, prestige, legend } = progress;
  if (!Number.isSafeInteger(level) || level < 1) return undefined;
  if (!Number.isSafeInteger(prestige) || prestige < 0) return undefined;
  if (typeof legend !== "boolean") return undefined;
  return { level, prestige, legend };
}
