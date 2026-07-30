import { z } from "zod";
import { Tribe, TribeSchema } from "../core/Schemas";
import { ServerEnv } from "./ServerEnv";

// TribeSchema is loose: extra per-tribe fields the API sends pass through
// into the game start info (and thus the analytics record) unchanged.
const CustomTribesResponseSchema = z.object({
  tribes: TribeSchema.array().max(100),
});

// A logged-in human in the lobby: in-game client id + account public id.
// Guests can't own tribe names and must be omitted.
export interface TribePoolPlayer {
  clientId: string;
  publicId: string;
}

/**
 * Fetch the boost-weighted pool of purchased bot tribe names for a game:
 * up to 10 owned by lobby players, then up to 10 from the global pool
 * (array order carries the slicing, so callers drop from the tail).
 *
 * Throws on timeout/non-200/malformed response — callers fail open and
 * start the game with organic bot names. The timeout must fit inside the
 * 2s prestart->start window (see GameManager.tick).
 */
export async function fetchCustomTribes(
  players: TribePoolPlayer[],
): Promise<Tribe[]> {
  const response = await fetch(`${ServerEnv.jwtIssuer()}/custom_tribes`, {
    method: "POST",
    signal: AbortSignal.timeout(1500),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ServerEnv.apiKey(),
    },
    body: JSON.stringify({ players: players.slice(0, 500) }),
  });
  if (!response.ok) {
    throw new Error(`custom_tribes returned ${response.status}`);
  }
  const parsed = CustomTribesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `custom_tribes returned malformed response: ${parsed.error.message}`,
    );
  }
  return parsed.data.tribes;
}
