/**
 * The warship tool: what a click does. A click on a warship removes it; a
 * click elsewhere places one for the picked nation, as the document allows
 * (see addWarship).
 */

import type { Edit } from "./DocumentEditor";
import {
  MAX_WARSHIPS,
  type ScenarioDocument,
  type ScenarioWarship,
  WATER,
  warshipsAllowed,
} from "./ScenarioDocument";

/** Why a click places nothing. */
export type WarshipProblem = "disabled" | "no_nation" | "land" | "too_many";

/**
 * The edit a click on `tile` makes for `nation` (an id, or null for none
 * picked), or why it makes none. A warship is drawn larger than its tile,
 * so a click within `reach` tiles of one hits it; the nearest is removed.
 */
export function warshipClick(
  doc: ScenarioDocument,
  tile: number,
  nation: string | null,
  reach: number,
): Edit | WarshipProblem {
  const x = tile % doc.width;
  const y = Math.floor(tile / doc.width);
  let hit: ScenarioWarship | null = null;
  let best = reach * reach;
  for (const w of doc.warships) {
    const dx = (w.tile % doc.width) - x;
    const dy = Math.floor(w.tile / doc.width) - y;
    const d = dx * dx + dy * dy;
    if (d <= best) {
      hit = w;
      best = d;
    }
  }
  if (hit !== null) return { type: "remove_warship", tile: hit.tile };
  if (!warshipsAllowed(doc.config)) return "disabled";
  if (nation === null) return "no_nation";
  if (doc.terrain[tile] !== WATER) return "land";
  if (doc.warships.length >= MAX_WARSHIPS) return "too_many";
  return { type: "place_warship", warship: { nation, tile } };
}
