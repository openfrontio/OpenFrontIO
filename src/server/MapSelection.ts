import { numPlayersConfig } from "../core/configuration/DefaultConfig";
import { GameMapType, GameMode } from "../core/game/Game";

const MAP_CAPACITIES = numPlayersConfig;

export interface MapSelectionCriteria {
  playerCount: number;
  gameMode: GameMode;
  queueType: "ranked" | "unranked";
}

/**
 * Select appropriate map for ranked match based on player count and game mode
 * Uses map capacity and competitive map preferences
 */
export function selectMapForRanked(
  criteria: MapSelectionCriteria,
): GameMapType {
  const { playerCount, gameMode } = criteria;

  // Get maps that can handle this player count
  const suitableMaps = getSuitableMaps(playerCount);

  // For ranked, prefer competitive maps
  const rankedMaps =
    gameMode === GameMode.FFA
      ? [
          GameMapType.World,
          GameMapType.Europe,
          GameMapType.Asia,
          GameMapType.NorthAmerica,
          GameMapType.Africa,
          GameMapType.Britannia,
        ]
      : [GameMapType.World, GameMapType.Europe]; // Team mode

  // Find intersection
  const viableMaps = suitableMaps.filter((map) => rankedMaps.includes(map));

  // Use ranked maps if available, otherwise fall back to all suitable maps
  const candidates = viableMaps.length > 0 ? viableMaps : suitableMaps;

  // Pick best fit (prefer maps closest to player count)
  return pickBestFit(candidates, playerCount);
}

/**
 * Get all maps that can handle the given player count
 * Map is suitable if playerCount is between small and large capacity
 */
function getSuitableMaps(playerCount: number): GameMapType[] {
  const suitable: GameMapType[] = [];

  for (const [mapKey, [large, , small]] of Object.entries(MAP_CAPACITIES)) {
    const map = mapKey as GameMapType;
    // Map can handle if playerCount is between small and large
    if (playerCount >= small && playerCount <= large) {
      suitable.push(map);
    }
  }

  return suitable;
}

/**
 * Pick the best fitting map based on player count
 * Selects map where player count is closest to the middle of its capacity range
 */
function pickBestFit(maps: GameMapType[], playerCount: number): GameMapType {
  // This should never happen now due to fallback in selectMapForRanked,
  // but keep a safe fallback just in case
  if (maps.length === 0) {
    return GameMapType.World;
  }

  // Pick map where playerCount is closest to the middle of its range
  let bestMap = maps[0];
  let bestScore = Infinity;

  for (const map of maps) {
    const [large, , small] = MAP_CAPACITIES[map];
    const midPoint = (large + small) / 2;
    const distance = Math.abs(playerCount - midPoint);

    if (distance < bestScore) {
      bestScore = distance;
      bestMap = map;
    }
  }

  return bestMap;
}
