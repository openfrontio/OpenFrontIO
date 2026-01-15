import { TileRef } from "../../../../src/core/game/GameMap.js";
import { MiniAStarAdapter } from "../../../../src/core/pathfinding/adapters/MiniAStarAdapter.js";
import { loadMap } from "./maps.js";

interface PathfindingOptions {
  includePfMini?: boolean;
  includeNavMesh?: boolean;
}

interface NavMeshResult {
  path: Array<[number, number]> | null;
  initialPath: Array<[number, number]> | null;
  gateways: Array<[number, number]> | null;
  timings: any;
  length: number;
  time: number;
}

interface PfMiniResult {
  path: Array<[number, number]> | null;
  length: number;
  time: number;
}

// Cache pathfinding adapters per map
const pfMiniCache = new Map<string, MiniAStarAdapter>();

/**
 * Get or create MiniAStar adapter for a map
 */
function getPfMiniAdapter(mapName: string, game: any): MiniAStarAdapter {
  if (!pfMiniCache.has(mapName)) {
    const adapter = new MiniAStarAdapter(game, { waterPath: true });
    pfMiniCache.set(mapName, adapter);
  }
  return pfMiniCache.get(mapName)!;
}

/**
 * Convert TileRef array to coordinate array
 */
function pathToCoords(
  path: TileRef[] | null,
  game: any,
): Array<[number, number]> | null {
  if (!path) return null;
  return path.map((tile) => [game.x(tile), game.y(tile)]);
}

/**
 * Compute pathfinding between two points
 */
export async function computePath(
  mapName: string,
  from: [number, number],
  to: [number, number],
  options: PathfindingOptions = {},
): Promise<NavMeshResult> {
  const { game, navMesh: navMeshAdapter } = await loadMap(mapName);

  // Convert coordinates to TileRefs
  const fromRef = game.ref(from[0], from[1]);
  const toRef = game.ref(to[0], to[1]);

  // Validate that both points are water tiles
  if (!game.isWater(fromRef)) {
    throw new Error(`Start point (${from[0]}, ${from[1]}) is not water`);
  }
  if (!game.isWater(toRef)) {
    throw new Error(`End point (${to[0]}, ${to[1]}) is not water`);
  }

  // Compute NavMesh path
  const navMeshPath = navMeshAdapter.findPath(fromRef, toRef, true);
  const path = pathToCoords(navMeshPath, game);

  const miniMap = game.miniMap();

  // Extract debug info
  let gateways: Array<[number, number]> | null = null;
  let initialPath: Array<[number, number]> | null = null;
  let timings: any = {};

  if (navMeshAdapter.debugInfo) {
    // Convert gatewayPath (TileRefs on miniMap) to full map coordinates
    if (navMeshAdapter.debugInfo.gatewayPath) {
      gateways = navMeshAdapter.debugInfo.gatewayPath.map((tile: TileRef) => {
        const x = miniMap.x(tile) * 2;
        const y = miniMap.y(tile) * 2;
        return [x, y] as [number, number];
      });
    }

    // Convert initial path
    if (navMeshAdapter.debugInfo.initialPath) {
      initialPath = navMeshAdapter.debugInfo.initialPath.map(
        (tile: TileRef) => [game.x(tile), game.y(tile)] as [number, number],
      );
    }

    timings = navMeshAdapter.debugInfo.timings || {};
  }

  return {
    path,
    initialPath,
    gateways,
    timings,
    length: path ? path.length : 0,
    time: timings.total ?? 0,
  };
}

/**
 * Compute only PathFinder.Mini path
 */
export async function computePfMiniPath(
  mapName: string,
  from: [number, number],
  to: [number, number],
): Promise<PfMiniResult> {
  const { game } = await loadMap(mapName);

  // Convert coordinates to TileRefs
  const fromRef = game.ref(from[0], from[1]);
  const toRef = game.ref(to[0], to[1]);

  // Validate that both points are water tiles
  if (!game.isWater(fromRef)) {
    throw new Error(`Start point (${from[0]}, ${from[1]}) is not water`);
  }
  if (!game.isWater(toRef)) {
    throw new Error(`End point (${to[0]}, ${to[1]}) is not water`);
  }

  // Compute PathFinder.Mini path
  const pfMiniAdapter = getPfMiniAdapter(mapName, game);
  const pfMiniStart = performance.now();
  const pfMiniPath = pfMiniAdapter.findPath(fromRef, toRef);
  const pfMiniEnd = performance.now();

  const path = pathToCoords(pfMiniPath, game);
  const time = pfMiniEnd - pfMiniStart;

  return {
    path,
    length: path ? path.length : 0,
    time,
  };
}

/**
 * Clear pathfinding adapter caches
 */
export function clearAdapterCaches() {
  pfMiniCache.clear();
}
