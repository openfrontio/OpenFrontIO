import { SCHEDULED_PUBLIC_GAME_TYPES, type PublicGames } from "../core/Schemas";

/** One-based position in the full scheduled bucket, excluding its countdown. */
export function getLobbyQueuePosition(
  lobbies: PublicGames | null,
  gameId: string,
): number | null {
  for (const type of SCHEDULED_PUBLIC_GAME_TYPES) {
    const queue = lobbies?.games[type]?.filter(
      (lobby) => lobby.startsAt === undefined,
    );
    const index = queue?.findIndex((lobby) => lobby.gameID === gameId);
    if (index !== undefined && index >= 0) return index + 1;
  }
  // Hosted, active, and missing lobbies have no scheduled queue position.
  return null;
}
