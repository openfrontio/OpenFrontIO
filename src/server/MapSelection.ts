import { GameMapType, GameMode } from "../core/game/Game";
// import { TeamCountConfig } from "../core/Schemas";

const MAP_CAPACITIES: Record<GameMapType, [number, number, number]> = {
  [GameMapType.Africa]: [100, 70, 50],
  [GameMapType.Asia]: [50, 40, 30],
  [GameMapType.Australia]: [70, 40, 30],
  [GameMapType.Baikal]: [100, 70, 50],
  [GameMapType.BetweenTwoSeas]: [70, 50, 40],
  [GameMapType.BlackSea]: [50, 30, 30],
  [GameMapType.Britannia]: [50, 30, 20],
  [GameMapType.DeglaciatedAntarctica]: [50, 40, 30],
  [GameMapType.EastAsia]: [50, 30, 20],
  [GameMapType.Europe]: [100, 70, 50],
  [GameMapType.EuropeClassic]: [50, 30, 30],
  [GameMapType.FalklandIslands]: [50, 30, 20],
  [GameMapType.FaroeIslands]: [20, 15, 10],
  [GameMapType.GatewayToTheAtlantic]: [100, 70, 50],
  [GameMapType.GiantWorldMap]: [100, 70, 50],
  [GameMapType.Halkidiki]: [100, 50, 40],
  [GameMapType.Iceland]: [50, 40, 30],
  [GameMapType.Italia]: [50, 30, 20],
  [GameMapType.Japan]: [20, 15, 10],
  [GameMapType.Mars]: [70, 40, 30],
  [GameMapType.Mena]: [70, 50, 40],
  [GameMapType.Montreal]: [60, 40, 30],
  [GameMapType.NorthAmerica]: [70, 40, 30],
  [GameMapType.Oceania]: [10, 10, 10],
  [GameMapType.Pangaea]: [20, 15, 10],
  [GameMapType.Pluto]: [100, 70, 50],
  [GameMapType.SouthAmerica]: [70, 50, 40],
  [GameMapType.StraitOfGibraltar]: [100, 70, 50],
  [GameMapType.World]: [50, 30, 20],
  [GameMapType.Yenisei]: [150, 100, 70],
};

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

  // Pick best fit (prefer maps closest to player count)
  return pickBestFit(viableMaps, playerCount);
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
  if (maps.length === 0) {
    // Fallback to World if no perfect match
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
