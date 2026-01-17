import { TileRef } from "../../../../src/core/game/GameMap.js";
import { PathFinding } from "../../../../src/core/pathfinding/PathFinder.js";
import { SpatialQuery } from "../../../../src/core/pathfinding/spatial/SpatialQuery.js";
import { DebugSpan } from "../../../../src/core/utilities/DebugSpan.js";
import { loadMap } from "./maps.js";

export interface SpatialQueryResult {
  selectedShore: [number, number] | null;
  path: Array<[number, number]> | null;
  shores: Array<[number, number]>;
  debug: {
    candidates: Array<[number, number]> | null;
    refinedPath: Array<[number, number]> | null;
    originalBestTile: [number, number] | null;
    newBestTile: [number, number] | null;
    timings: Record<string, number>;
  };
}

/**
 * Extract timings from DebugSpan hierarchy
 */
function extractTimings(span: {
  name: string;
  duration?: number;
  children: any[];
}): Record<string, number> {
  const timings: Record<string, number> = {};

  if (span.duration !== undefined) {
    timings[span.name] = span.duration;
  }

  for (const child of span.children) {
    Object.assign(timings, extractTimings(child));
  }

  return timings;
}

/**
 * Convert TileRef to coordinate tuple
 */
function tileToCoord(tile: TileRef, game: any): [number, number] {
  return [game.x(tile), game.y(tile)];
}

/**
 * Convert TileRef array to coordinate array
 */
function tilesToCoords(
  tiles: TileRef[] | null | undefined,
  game: any,
): Array<[number, number]> | null {
  if (!tiles) return null;
  return tiles.map((tile) => tileToCoord(tile, game));
}

/**
 * Compute spatial query for transport ship launch
 */
export async function computeSpatialQuery(
  mapName: string,
  ownedTiles: number[],
  target: [number, number],
): Promise<SpatialQueryResult> {
  const { game } = await loadMap(mapName);

  const targetRef = game.ref(target[0], target[1]) as TileRef;

  // Validate target is water or shore
  if (!game.isWater(targetRef) && !game.isShore(targetRef)) {
    throw new Error(
      `Target (${target[0]}, ${target[1]}) must be water or shore`,
    );
  }

  // Convert owned tile indices to TileRefs
  const ownedRefs = ownedTiles.map((idx) => {
    const x = idx % game.width();
    const y = Math.floor(idx / game.width());
    return game.ref(x, y) as TileRef;
  });

  // Create mock player that returns owned tiles as border tiles
  // The SpatialQuery will filter to actual shore tiles
  const mockPlayer = {
    isPlayer: () => true,
    smallID: () => 999, // Arbitrary ID for visualization
    borderTiles: function* () {
      for (const tile of ownedRefs) {
        yield tile;
      }
    },
  };

  // Get target water component for filtering
  const targetComponent = game.getWaterComponent(targetRef);

  // Pre-compute all valid shore tiles for visualization
  const allShores: TileRef[] = [];
  for (const tile of ownedRefs) {
    if (game.isShore(tile) && game.isLand(tile)) {
      const tComponent = game.getWaterComponent(tile);
      if (tComponent === targetComponent) {
        allShores.push(tile);
      }
    }
  }

  // Enable DebugSpan to capture internal state
  DebugSpan.enable();

  // Run spatial query
  const spatialQuery = new SpatialQuery(game);
  const selectedShore = spatialQuery.closestShoreByWater(
    mockPlayer as any,
    targetRef,
  );

  // Get span data
  const span = DebugSpan.getLastSpan();
  DebugSpan.disable();

  // Extract debug info from span
  let candidates: TileRef[] | null = null;
  let refinedPath: TileRef[] | null = null;
  let originalBestTile: TileRef | null = null;
  let newBestTile: TileRef | null = null;

  if (span?.data) {
    candidates = (span.data.$candidates as TileRef[] | undefined) ?? null;
    refinedPath = (span.data.$refinedPath as TileRef[] | undefined) ?? null;
    originalBestTile =
      (span.data.$originalBestTile as TileRef | undefined) ?? null;
    newBestTile = (span.data.$newBestTile as TileRef | undefined) ?? null;
  }

  // Compute full path if we have a selected shore
  let path: TileRef[] | null = null;
  if (selectedShore) {
    path = PathFinding.Water(game).findPath(selectedShore, targetRef);
  }

  const timings = span ? extractTimings(span) : {};

  return {
    selectedShore: selectedShore ? tileToCoord(selectedShore, game) : null,
    path: tilesToCoords(path, game),
    shores: allShores.map((t) => tileToCoord(t, game)),
    debug: {
      candidates: tilesToCoords(candidates, game),
      refinedPath: tilesToCoords(refinedPath, game),
      originalBestTile: originalBestTile
        ? tileToCoord(originalBestTile, game)
        : null,
      newBestTile: newBestTile ? tileToCoord(newBestTile, game) : null,
      timings,
    },
  };
}
