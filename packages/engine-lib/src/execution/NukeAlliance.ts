import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { Structures } from "@openfront/engine-api/game/GameTypes";
import { GameLike } from "@openfront/engine-api/game/ReadViews";
import { NukeMagnitude } from "../configuration/Config";

export interface NukeBlastParams {
  gm: GameMap;
  targetTile: TileRef;
  magnitude: NukeMagnitude;
}

/**
 * Counts how many tiles each player has in the nuke's blast zone.
 *
 * returns Map of player ID and weighted tile count
 */
export function computeNukeBlastCounts(
  params: NukeBlastParams,
): Map<number, number> {
  const { gm, targetTile, magnitude } = params;

  const inner2 = magnitude.inner * magnitude.inner;
  const counts = new Map<number, number>();

  gm.circleSearch(targetTile, magnitude.outer, (tile: TileRef, d2: number) => {
    const ownerSmallId = gm.ownerID(tile);
    if (ownerSmallId > 0) {
      const weight = d2 <= inner2 ? 1 : 0.5;
      const prev = counts.get(ownerSmallId) ?? 0;
      counts.set(ownerSmallId, prev + weight);
    }
    return true;
  });

  return counts;
}

export interface NukeAllianceCheckParams {
  game: GameLike;
  targetTile: TileRef;
  magnitude: NukeMagnitude;
  allySmallIds?: Set<number>;
  threshold: number;
}

// Checks if nuking this tile would break an alliance.
// Returns true if either:
// 1. The weighted tile count for any ally exceeds the threshold
// 2. Any allied structure would be destroyed
export function wouldNukeBreakAlliance(
  params: NukeAllianceCheckParams,
): boolean {
  const { game, targetTile, magnitude, allySmallIds, threshold } = params;

  if (!allySmallIds || allySmallIds.size === 0) {
    return false;
  }

  // Check if any allied structure would be destroyed
  const wouldDestroyAlliedStructure = game.anyUnitNearby(
    targetTile,
    magnitude.outer,
    Structures.types,
    (unit) =>
      unit.owner().isPlayer() && allySmallIds.has(unit.owner().smallID()),
  );
  if (wouldDestroyAlliedStructure) return true;

  const inner2 = magnitude.inner * magnitude.inner;
  const allyTileCounts = new Map<number, number>();

  let result = false;

  game.circleSearch(
    targetTile,
    magnitude.outer,
    (tile: TileRef, d2: number) => {
      const ownerSmallId = game.ownerID(tile);
      if (ownerSmallId > 0 && allySmallIds.has(ownerSmallId)) {
        const weight = d2 <= inner2 ? 1 : 0.5;
        const newCount = (allyTileCounts.get(ownerSmallId) ?? 0) + weight;
        allyTileCounts.set(ownerSmallId, newCount);

        if (newCount > threshold) {
          result = true;
          return false; // Found one! Stop searching.
        }
      }
      return true;
    },
  );

  return result;
}

// Same as wouldNukeBreakAlliance(), but takes time to find every player
// that would be "angered" from this nuke.
// This includes unallied players!
export function listNukeBreakAlliance(
  params: NukeAllianceCheckParams,
): Set<number> {
  const { game, targetTile, magnitude, threshold } = params;

  // Collect all players that should have alliance broken:
  // either exceeds tile threshold OR has a structure in blast radius
  const playersToBreakAllianceWith = new Set<number>();

  // compute tile breakage threshold
  const blastCounts = computeNukeBlastCounts({
    gm: game,
    targetTile,
    magnitude,
  });
  for (const [playerSmallId, totalWeight] of blastCounts) {
    if (totalWeight > threshold) {
      playersToBreakAllianceWith.add(playerSmallId);
    }
  }

  // Also check if any allied structures would be destroyed
  game
    .nearbyUnits(targetTile, magnitude.outer, Structures.types)
    .forEach(({ unit }) =>
      playersToBreakAllianceWith.add(unit.owner().smallID()),
    );

  return playersToBreakAllianceWith;
}
