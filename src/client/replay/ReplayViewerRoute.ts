/**
 * The replay viewer's URL hash, `#replay-viewer=<gameID>`. Kept out of
 * ReplayViewer so Main can check it without loading the viewer.
 */

import { GAME_ID_REGEX } from "../../core/Schemas";

const HASH = "#replay-viewer";

/** The game ID, or null when the hash is not ours. */
export function parseReplayViewerHash(hash: string): string | null {
  if (!hash.startsWith(`${HASH}=`)) return null;
  const id = hash.slice(HASH.length + 1);
  return GAME_ID_REGEX.test(id) ? id : null;
}
