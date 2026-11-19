import type { GameID } from "@openfront/engine-api/Schemas";
import { getPersistentID } from "./Auth";

// The games this tab has been let into, per account. The server remembers
// every account it admitted to a game, through leaving the lobby, and lets it
// back in without a Turnstile token, which it would not look at anyway: a
// token is single-use and theirs was redeemed on the first join. So rejoining
// one of these needs no bot check, and skipping it spares the player a second
// challenge, which on some setups never even starts. Keyed by account because
// the server's memory is: after a login or logout the server sees a stranger.

const admitted = new Set<string>();

const key = (gameID: GameID) => `${getPersistentID()}:${gameID}`;

/** Called once the server has let this tab into `gameID`. */
export function rememberAdmitted(gameID: GameID): void {
  admitted.add(key(gameID));
}

export function wasAdmitted(gameID: GameID): boolean {
  return admitted.has(key(gameID));
}
