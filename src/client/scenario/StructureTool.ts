/**
 * The structure tool: what a click does. A click on a structure removes
 * it; a click elsewhere places one of the picked type and level for the
 * nation that owns the tile, as the document allows (see checkStructure).
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Edit } from "./DocumentEditor";
import {
  isShore,
  type ScenarioDocument,
  type ScenarioStructure,
} from "./ScenarioDocument";

export type StructureType = ScenarioStructure["type"];

/** Why a click places nothing. */
export type StructureProblem = "unowned" | "no_shore" | "disabled";

/**
 * The edit a click on `tile` makes, or why it makes none. A structure is
 * drawn larger than its tile, so a click within `reach` tiles of one hits
 * it; the nearest is removed.
 */
export function structureClick(
  doc: ScenarioDocument,
  tile: number,
  type: StructureType,
  level: number,
  reach: number,
): Edit | StructureProblem {
  const x = tile % doc.width;
  const y = Math.floor(tile / doc.width);
  let hit: ScenarioStructure | null = null;
  let best = reach * reach;
  for (const s of doc.structures) {
    const dx = (s.tile % doc.width) - x;
    const dy = Math.floor(s.tile / doc.width) - y;
    const d = dx * dx + dy * dy;
    if (d <= best) {
      hit = s;
      best = d;
    }
  }
  if (hit !== null) return { type: "remove_structure", tile: hit.tile };
  if (doc.config.disabledUnits?.includes(type)) return "disabled";
  const owner = doc.owners[tile];
  if (owner === 0) return "unowned";
  if (type === UnitType.Port && !isShore(doc, tile)) return "no_shore";
  return {
    type: "place_structure",
    structure: {
      type,
      tile,
      nation: doc.nations[owner - 1].id,
      // A defense post has no levels.
      level: type === UnitType.DefensePost ? 1 : level,
    },
  };
}
