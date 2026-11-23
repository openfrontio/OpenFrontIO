/**
 * The units tool: what a click does. A click on or near a unit, a
 * structure or a warship, removes the nearest. A click elsewhere places one
 * of the picked type, as the document allows: a structure for the nation
 * that owns the tile (see checkStructure), or a warship on water for the
 * nation picked in the nations panel (see addWarship).
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Edit } from "./DocumentEditor";
import {
  isShore,
  MAX_WARSHIPS,
  type ScenarioDocument,
  type ScenarioStructure,
  WATER,
} from "./ScenarioDocument";

export type StructureType = ScenarioStructure["type"];

/** The types the tool places. */
export type UnitPick = StructureType | UnitType.Warship;

/** Why a click places nothing. */
export type UnitProblem =
  | "disabled"
  | "unowned"
  | "no_shore"
  | "no_nation"
  | "land"
  | "too_many";

/**
 * The edit a click on `tile` makes, or why it makes none. A structure
 * takes `level`; a warship belongs to `nation` (an id, or null for none
 * picked). A unit is drawn larger than its tile, so a click within `reach`
 * tiles of one hits it.
 */
export function unitClick(
  doc: ScenarioDocument,
  tile: number,
  type: UnitPick,
  level: number,
  nation: string | null,
  reach: number,
): Edit | UnitProblem {
  const hit = nearestUnit(doc, tile, reach);
  if (hit !== null) return hit;
  if (doc.config.disabledUnits?.includes(type)) return "disabled";
  if (type === UnitType.Warship) {
    if (nation === null) return "no_nation";
    if (doc.terrain[tile] !== WATER) return "land";
    if (doc.warships.length >= MAX_WARSHIPS) return "too_many";
    return { type: "place_warship", warship: { nation, tile } };
  }
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

/** The removal of the unit nearest `tile` within `reach`, if any. */
function nearestUnit(
  doc: ScenarioDocument,
  tile: number,
  reach: number,
): Edit | null {
  const x = tile % doc.width;
  const y = Math.floor(tile / doc.width);
  let hit: Edit | null = null;
  let best = reach * reach;
  const near = (t: number) => {
    const dx = (t % doc.width) - x;
    const dy = Math.floor(t / doc.width) - y;
    const d = dx * dx + dy * dy;
    if (d > best) return false;
    best = d;
    return true;
  };
  for (const s of doc.structures) {
    if (near(s.tile)) hit = { type: "remove_structure", tile: s.tile };
  }
  for (const w of doc.warships) {
    if (near(w.tile)) hit = { type: "remove_warship", tile: w.tile };
  }
  return hit;
}
