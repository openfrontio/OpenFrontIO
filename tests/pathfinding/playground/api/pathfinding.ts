import { TileRef } from "../../../../src/core/game/GameMap.js";
import { AStarWaterHierarchical } from "../../../../src/core/pathfinding/algorithms/AStar.WaterHierarchical.js";
import { BresenhamSmoothingTransformer } from "../../../../src/core/pathfinding/smoothing/BresenhamPathSmoother.js";
import { ComponentCheckTransformer } from "../../../../src/core/pathfinding/transformers/ComponentCheckTransformer.js";
import { MiniMapTransformer } from "../../../../src/core/pathfinding/transformers/MiniMapTransformer.js";
import { ShoreCoercingTransformer } from "../../../../src/core/pathfinding/transformers/ShoreCoercingTransformer.js";
import {
  PathFinder,
  SteppingPathFinder,
} from "../../../../src/core/pathfinding/types.js";
import { getAdapter } from "../../utils.js";
import { COMPARISON_ADAPTERS, loadMap } from "./maps.js";

// Primary result with debug info
interface PrimaryResult {
  path: Array<[number, number]> | null;
  length: number;
  time: number;
  debug: {
    nodePath: Array<[number, number]> | null;
    initialPath: Array<[number, number]> | null;
    timings: Record<string, number>;
  };
}

// Comparison result (path + timing only)
interface ComparisonResult {
  adapter: string;
  path: Array<[number, number]> | null;
  length: number;
  time: number;
}

export interface PathfindResult {
  primary: PrimaryResult;
  comparisons: ComparisonResult[];
}

// Cache adapters per map
const adapterCache = new Map<
  string,
  Map<string, SteppingPathFinder<TileRef>>
>();

/**
 * Get or create an adapter for a map
 */
function getOrCreateAdapter(
  mapName: string,
  adapterName: string,
  game: any,
): SteppingPathFinder<TileRef> {
  if (!adapterCache.has(mapName)) {
    adapterCache.set(mapName, new Map());
  }
  const mapAdapters = adapterCache.get(mapName)!;

  if (!mapAdapters.has(adapterName)) {
    mapAdapters.set(adapterName, getAdapter(game, adapterName));
  }
  return mapAdapters.get(adapterName)!;
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
 * Build the full transformer chain like PathFinding.Water() does
 */
function buildWrappedPathFinder(
  hpaStar: AStarWaterHierarchical,
  game: any,
  graph: any,
): PathFinder<TileRef> {
  const miniMap = game.miniMap();
  const componentCheckFn = (t: TileRef) => graph.getComponentId(t);

  // Chain: hpaStar -> ComponentCheck -> Bresenham -> ShoreCoercing -> MiniMap
  const withComponentCheck = new ComponentCheckTransformer(
    hpaStar,
    componentCheckFn,
  );
  const withSmoothing = new BresenhamSmoothingTransformer(
    withComponentCheck,
    miniMap,
  );
  const withShoreCoercing = new ShoreCoercingTransformer(
    withSmoothing,
    miniMap,
  );
  const withMiniMap = new MiniMapTransformer(withShoreCoercing, game, miniMap);

  return withMiniMap;
}

/**
 * Compute primary path using AStarWaterHierarchical with debug info
 * Uses the same transformer chain as PathFinding.Water()
 */
function computePrimaryPath(
  hpaStar: AStarWaterHierarchical,
  game: any,
  graph: any,
  fromRef: TileRef,
  toRef: TileRef,
): PrimaryResult {
  const miniMap = game.miniMap();

  // Build wrapped pathfinder with all transformers
  const wrappedPf = buildWrappedPathFinder(hpaStar, game, graph);

  // Enable debug mode to capture internal state
  hpaStar.debugMode = true;

  const start = performance.now();
  const path = wrappedPf.findPath(fromRef, toRef);
  const time = performance.now() - start;

  const debugInfo = hpaStar.debugInfo;

  // Convert node path (miniMap coords) to full map coords
  let nodePath: Array<[number, number]> | null = null;
  if (debugInfo?.nodePath) {
    nodePath = debugInfo.nodePath.map((tile: TileRef) => {
      const x = miniMap.x(tile) * 2;
      const y = miniMap.y(tile) * 2;
      return [x, y] as [number, number];
    });
  }

  // Convert initialPath (miniMap TileRefs) to full map coords
  let initialPath: Array<[number, number]> | null = null;
  if (debugInfo?.initialPath) {
    initialPath = debugInfo.initialPath.map((tile: TileRef) => {
      const x = miniMap.x(tile) * 2;
      const y = miniMap.y(tile) * 2;
      return [x, y] as [number, number];
    });
  }

  return {
    path: pathToCoords(path, game),
    length: path ? path.length : 0,
    time,
    debug: {
      nodePath,
      initialPath,
      timings: debugInfo?.timings ?? {},
    },
  };
}

/**
 * Compute comparison path using adapter
 */
function computeComparisonPath(
  adapter: SteppingPathFinder<TileRef>,
  game: any,
  fromRef: TileRef,
  toRef: TileRef,
  adapterName: string,
): ComparisonResult {
  const start = performance.now();
  const path = adapter.findPath(fromRef, toRef);
  const time = performance.now() - start;

  return {
    adapter: adapterName,
    path: pathToCoords(path, game),
    length: path ? path.length : 0,
    time,
  };
}

/**
 * Compute pathfinding between two points
 */
export async function computePath(
  mapName: string,
  from: [number, number],
  to: [number, number],
  options: { adapters?: string[] } = {},
): Promise<PathfindResult> {
  const { game, hpaStar } = await loadMap(mapName);
  const graph = game.miniWaterGraph();

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

  // Compute primary path (HPA* with debug)
  const primary = computePrimaryPath(hpaStar, game, graph, fromRef, toRef);

  // Compute comparison paths
  const selectedAdapters = options.adapters ?? COMPARISON_ADAPTERS;
  const comparisons: ComparisonResult[] = [];

  for (const adapterName of selectedAdapters) {
    if (!COMPARISON_ADAPTERS.includes(adapterName)) {
      console.warn(`Unknown adapter: ${adapterName}, skipping`);
      continue;
    }

    try {
      const adapter = getOrCreateAdapter(mapName, adapterName, game);
      const result = computeComparisonPath(
        adapter,
        game,
        fromRef,
        toRef,
        adapterName,
      );
      comparisons.push(result);
    } catch (error) {
      console.error(`Error with adapter ${adapterName}:`, error);
      comparisons.push({
        adapter: adapterName,
        path: null,
        length: 0,
        time: 0,
      });
    }
  }

  return { primary, comparisons };
}

/**
 * Clear pathfinding adapter caches
 */
export function clearAdapterCaches() {
  adapterCache.clear();
}
