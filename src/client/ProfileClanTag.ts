/**
 * The clan tag a player's profile shows: the tag from their most recent game
 * that had one, while they're still a member of that clan.
 *
 * `games` is the first page of the player's public game history, newest first
 * (GET /public/player/:publicId/games). Games played without a tag are
 * skipped, so playing untagged doesn't clear it, and so is a tag of a clan
 * they've since left (or never belonged to), so an older game's tag can still
 * count. `clans` is the clans they belong to now; the tag comes back in the
 * clan's own case. null when no game on the page qualifies: no tag is shown.
 */
export function latestGameClanTag(
  games: readonly { clanTag: string | null }[],
  clans: readonly { tag: string }[],
): string | null {
  for (const game of games) {
    const played = game.clanTag?.trim().toUpperCase();
    if (!played) continue;
    const clan = clans.find((c) => c.tag.toUpperCase() === played);
    if (clan) return clan.tag;
  }
  return null;
}
