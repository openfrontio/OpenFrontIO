import type { PublicProgress } from "@openfront/shared/ApiSchemas";
import { getUserMe } from "./Api";
import { fetchPublicPlayerProgress } from "./ProgressionApi";

/**
 * A player's level, with the prestige history and milestones the Progression
 * tab shows: the player profile's, and the account's own.
 *
 * Everyone's level, your own included, comes from the public endpoint first:
 * the /users/@me copy is cached from page load and would miss the games
 * played since, and it has neither the history nor the milestones. But that
 * endpoint 404s for a player who hides their level — for everyone, them
 * included — and they still see their own level. So for your OWN publicId
 * only, no public progress falls back to your /users/@me copy (memoised:
 * normally no request). Nobody else's ever does, so a hidden level stays
 * hidden from others. Null when there's no progress to show.
 */
export async function loadPlayerProgress(
  publicId: string,
): Promise<PublicProgress | null> {
  try {
    const progress = await fetchPublicPlayerProgress(publicId);
    if (progress !== false) return progress;
    const me = await getUserMe();
    if (me === false || me.player.publicId !== publicId) return null;
    return me.player.progress ?? null;
  } catch {
    return null;
  }
}
