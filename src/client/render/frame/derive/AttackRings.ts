import type { AttackRingInput, UnitState } from "../../types";
import { UT_TRANSPORT } from "../../types";

/**
 * Extract attack ring indicators for transport ships with active targets.
 * Optionally filter to a specific owner (live path filters to local player).
 */
export function extractAttackRings(
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  ownerFilter?: number,
): AttackRingInput[] {
  const rings: AttackRingInput[] = [];
  for (const u of units.values()) {
    if (u.unitType !== UT_TRANSPORT) continue;
    if (u.targetTile === null || !u.isActive || u.retreating) continue;
    if (ownerFilter !== undefined && u.ownerID !== ownerFilter) continue;
    const t = u.targetTile;
    rings.push({ x: t % mapW, y: (t - (t % mapW)) / mapW, unitId: u.id });
  }
  return rings;
}

/**
 * Targeted variant — iterates only pre-classified transport IDs instead of all units.
 * Used by the live path where UnitClassifier maintains the transport ID set.
 */
export function extractAttackRingsFromIds(
  transportIds: readonly number[],
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  ownerFilter?: number,
): AttackRingInput[] {
  const rings: AttackRingInput[] = [];
  for (const id of transportIds) {
    const u = units.get(id);
    if (!u || u.targetTile === null || !u.isActive || u.retreating) continue;
    if (ownerFilter !== undefined && u.ownerID !== ownerFilter) continue;
    const t = u.targetTile;
    rings.push({ x: t % mapW, y: (t - (t % mapW)) / mapW, unitId: u.id });
  }
  return rings;
}
