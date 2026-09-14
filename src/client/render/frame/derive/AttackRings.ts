import type { AttackRingInput, UnitState } from "../../types";
import { UT_TRANSPORT } from "../../types";

/**
 * Extract attack ring indicators for transport ships with active targets.
 * Optionally filter to a specific owner (live path filters to local player).
 */
export function extractAttackRings(
  units: ReadonlyMap<number, UnitState>,
  mapW: number,
  owner: number,
): AttackRingInput[] {
  const rings: AttackRingInput[] = [];
  for (const u of units.values()) {
    if (u.unitType !== UT_TRANSPORT) continue;
    if (u.targetTile === null || !u.isActive || u.retreating) continue;
    if (u.ownerID !== owner) continue;
    const t = u.targetTile;
    rings.push({ x: t % mapW, y: (t - (t % mapW)) / mapW, unitId: u.id });
  }
  return rings;
}
