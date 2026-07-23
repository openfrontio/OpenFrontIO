import { z } from "zod";
import { ServerEnv } from "./ServerEnv";

export type RosterPlayer = {
  username: string;
  clanTag: string | null;
};

const UsernameCheckResponseSchema = z.object({
  players: z.array(
    z.object({
      username: z.string(),
      clanTag: z.string().nullable().optional(),
    }),
  ),
});

/**
 * POST the roster to the API's username_check endpoint, which returns the
 * display-ready (username, clanTag) pair for each player in request order:
 * banned usernames come back as deterministic shadow names, banned tags as
 * null, surviving tags uppercased. Retries once on a transient failure
 * (5xx / timeout / network); returns null when that also fails or on a 4xx
 * (bad payload / auth — retrying as-is won't help). Callers start the game
 * with names as-is rather than blocking the start.
 */
export async function fetchCensoredPlayers(
  players: RosterPlayer[],
): Promise<RosterPlayer[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    try {
      const response = await fetch(`${ServerEnv.jwtIssuer()}/username_check`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ServerEnv.apiKey(),
        },
        body: JSON.stringify({ players }),
      });
      if (response.status >= 400 && response.status < 500) {
        return null;
      }
      if (!response.ok) {
        continue;
      }
      const parsed = UsernameCheckResponseSchema.safeParse(
        await response.json(),
      );
      if (!parsed.success || parsed.data.players.length !== players.length) {
        return null;
      }
      return parsed.data.players.map((p) => ({
        username: p.username,
        clanTag: p.clanTag ?? null,
      }));
    } catch {
      // Timeout or network error — retry once.
    }
  }
  return null;
}
