// Versioned app shells let archived games from older builds be replayed after
// their deployment is gone (#4934). Every deploy uploads a fully-rendered
// index-<short-commit>.html next to the hashed assets on the CDN (see
// update.sh); when a replay's record was produced by a different build, the
// client navigates to the matching shell, whose baked gitCommit satisfies the
// version check and whose bundle simulates the game with the rules it was
// played under.

import { GameID } from "../core/Schemas";

// update.sh derives the same prefix from commit.txt with ${FULL_COMMIT:0:7}.
const SHORT_COMMIT_LENGTH = 7;

// URL of the versioned shell for a game record, with the game id in the hash
// (#join=<id>, handled in Main.ts) because static CDN hosting has no path
// routing. Null when no shell can exist: no CDN configured (dev), or the
// record's commit is not a full SHA (e.g. "DEV").
export function versionedReplayUrl(
  cdnBase: string,
  recordCommit: string,
  gameID: GameID,
): string | null {
  if (cdnBase === "") return null;
  if (!/^[0-9a-f]{40}$/.test(recordCommit)) return null;
  const shortCommit = recordCommit.slice(0, SHORT_COMMIT_LENGTH);
  return `${cdnBase.replace(/\/+$/, "")}/index-${shortCommit}.html#join=${gameID}`;
}

// True when the current document is itself a versioned shell. Used to stop a
// second redirect: if the record still mismatches there (e.g. a short-commit
// collision), redirecting again would loop forever.
export function isVersionedReplayPage(pathname: string): boolean {
  return /\/index-[0-9a-f]+\.html$/.test(pathname);
}
