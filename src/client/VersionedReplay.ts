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

const PROBE_TIMEOUT_MS = 3000;

// The versioned shell URL for a game from another build, if that shell is
// actually served. Null on a shell host (redirecting again would loop), in
// dev, or when the probe fails. The probe requires text/html so a misrouted
// host that answers 200 with something else can't strand the player on a
// broken page.
export async function findVersionedShell(
  audience: string,
  gameID: GameID,
  hostname: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  if (isReplayShellHost(hostname)) return null;
  const url = versionedReplayUrl(audience, gameID);
  if (url === null) return null;
  try {
    const probe = await fetchFn.call(globalThis, url, {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!probe.ok) return null;
    const contentType = probe.headers.get("content-type") ?? "";
    return contentType.includes("text/html") ? url : null;
  } catch {
    return null;
  }
}
