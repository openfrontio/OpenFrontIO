import type { PlayerState, PlayerStatusData, UnitState } from "../../types";
import { NUKE_TYPES, UT_MIRV_WARHEAD } from "../../types";

/** Unit types that indicate an active nuke is in flight. */
const NUKE_ACTIVE_TYPES: ReadonlySet<string> = new Set([
  ...NUKE_TYPES,
  UT_MIRV_WARHEAD,
]);

/**
 * Compute per-player status flags for the name/status-icon pass.
 *
 * This is the replay-path version — no local player concept.
 * All relative flags (alliance, allianceReq, target, embargo, nukeTargetsMe)
 * are always false. The live path uses the shim's own computePlayerStatus
 * which has local-player awareness.
 */
export function computePlayerStatus(
  players: ReadonlyMap<number, PlayerState>,
  units: ReadonlyMap<number, UnitState>,
): Map<number, PlayerStatusData> {
  const result = new Map<number, PlayerStatusData>();

  // Nuke owners: players who have an active nuke in flight
  const nukeOwners = new Set<number>();
  for (const u of units.values()) {
    if (u.isActive && NUKE_ACTIVE_TYPES.has(u.unitType)) {
      nukeOwners.add(u.ownerID);
    }
  }

  // Crown: alive player with most tiles
  let crownSmallID = -1;
  let maxTiles = 0;
  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    if (ps.tilesOwned > maxTiles) {
      maxTiles = ps.tilesOwned;
      crownSmallID = ps.smallID;
    }
  }

  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    const crown = ps.smallID === crownSmallID;
    const traitor = ps.isTraitor;
    const disconnected = ps.isDisconnected;
    const traitorRemainingTicks = ps.traitorRemainingTicks;
    const nukeActive = nukeOwners.has(ps.smallID);

    if (
      crown ||
      traitor ||
      disconnected ||
      traitorRemainingTicks > 0 ||
      nukeActive
    ) {
      result.set(ps.smallID, {
        crown,
        traitor,
        disconnected,
        alliance: false,
        allianceReq: false,
        target: false,
        embargo: false,
        nukeActive,
        nukeTargetsMe: false,
        traitorRemainingTicks,
        allianceFraction: 0,
      });
    }
  }
  return result;
}
