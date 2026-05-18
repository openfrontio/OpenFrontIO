import type { NukeTelegraphData, UnitState } from "../../types";
import { NUKE_MAGNITUDES } from "../../types";

/**
 * Extract nuke telegraph circles for active nukes with targets.
 *
 * When `friendlyIDs` is provided, only nukes owned by those players are
 * included (live game — you see your own + teammates' telegraphs).
 * When omitted, all nukes are included (replay / spectator).
 */
export function extractNukeTelegraphs(
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  friendlyIDs?: ReadonlySet<number>,
): NukeTelegraphData[] {
  const telegraphs: NukeTelegraphData[] = [];
  for (const u of units.values()) {
    if (u.targetTile === null || !u.isActive) continue;
    if (friendlyIDs && !friendlyIDs.has(u.ownerID)) continue;
    const mag = NUKE_MAGNITUDES[u.unitType];
    if (!mag) continue;
    telegraphs.push({
      x: u.targetTile % mapW,
      y: (u.targetTile - (u.targetTile % mapW)) / mapW,
      innerRadius: mag.inner,
      outerRadius: mag.outer,
    });
  }
  return telegraphs;
}

/**
 * Targeted variant — iterates only pre-classified nuke IDs instead of all units.
 * Used by the live path where UnitClassifier maintains the nuke ID set.
 */
export function extractNukeTelegraphsFromIds(
  nukeIds: readonly number[],
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  friendlyIDs?: ReadonlySet<number>,
): NukeTelegraphData[] {
  const telegraphs: NukeTelegraphData[] = [];
  for (const id of nukeIds) {
    const u = units.get(id);
    if (!u || u.targetTile === null || !u.isActive) continue;
    if (friendlyIDs && !friendlyIDs.has(u.ownerID)) continue;
    const mag = NUKE_MAGNITUDES[u.unitType];
    if (!mag) continue;
    telegraphs.push({
      x: u.targetTile % mapW,
      y: (u.targetTile - (u.targetTile % mapW)) / mapW,
      innerRadius: mag.inner,
      outerRadius: mag.outer,
    });
  }
  return telegraphs;
}
