/**
 * The scenario editor's URL hash: `#scenario-editor` for its start screen,
 * `#scenario-editor=<draftID>` for a draft, the API's id for it. Kept out of
 * ScenarioEditor so Main and the menu can use it without loading the editor.
 */

import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";

/**
 * The account flare that lets a player create and publish scenarios
 * (docs/ScenarioEditor.md, "Entitlement"). The API checks it; the client
 * only shows the editor's menu entry for it.
 */
export const SCENARIO_EDITOR_FLARE = "scenario_editor";

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
