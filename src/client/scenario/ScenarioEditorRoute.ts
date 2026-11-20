/**
 * The scenario editor's URL hash: `#scenario-editor` for its start screen,
 * `#scenario-editor=<draftID>` for a draft. Kept out of ScenarioEditor so
 * Main can check it without loading the editor.
 */

import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";

const HASH = "#scenario-editor";

/** The draft to open (null for none), or null when the hash is not ours. */
export function parseScenarioEditorHash(
  hash: string,
): { draft: string | null } | null {
  if (hash === HASH) return { draft: null };
  if (!hash.startsWith(`${HASH}=`)) return null;
  const draft = hash.slice(HASH.length + 1);
  return GAME_ID_REGEX.test(draft) ? { draft } : null;
}

export function scenarioEditorHash(draft: string | null): string {
  return draft === null ? HASH : `${HASH}=${draft}`;
}
