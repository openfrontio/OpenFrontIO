// Versioned app shells let archived games from older builds be replayed after
// their deployment is gone (#4934). Every deploy uploads a fully-rendered
// index-<short-commit>.html next to the hashed assets in the public bucket
// (see update.sh). The API worker serves them on replay.<domain>, with
// replay.<domain>/<gameId> as the canonical URL: the worker resolves the
// archived record's gitCommit and serves the matching shell there, so a
// mismatched replay just navigates to that URL and the shell's build
// simulates the game with the rules it was played under.

import { GameID } from "../core/Schemas";

// Canonical replay URL for a game. The replay host derives from the JWT
// audience exactly like getApiBase() derives api.<audience>. Null in dev
// (localhost audience), where no replay host exists.
export function versionedReplayUrl(
  audience: string,
  gameID: GameID,
): string | null {
  if (audience === "" || audience === "localhost") return null;
  return `https://replay.${audience}/${gameID}`;
}

// True when the current document is served from a replay shell host. Used to
// stop a second redirect (if the record still mismatches on the shell,
// redirecting again would loop forever) and to keep shell URLs intact.
export function isReplayShellHost(hostname: string): boolean {
  return hostname.startsWith("replay.");
}
