import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { logger } from "./Logger";
import { readMapFile } from "./MapFiles";

const log = logger.child({ component: "MapLandTiles" });

const landTilesCache = new Map<GameMapType, number>();

// Reads the number of land tiles for a map. Throws if the manifest can't be
// read, for callers that must not guess (the hosted lobby player cap).
export async function readMapLandTiles(map: GameMapType): Promise<number> {
  const cached = landTilesCache.get(map);
  if (cached !== undefined) return cached;

  const raw = (await readMapFile(map, "manifest.json")).toString("utf8");
  const tiles = (JSON.parse(raw) as { map?: { num_land_tiles?: unknown } }).map
    ?.num_land_tiles;
  if (typeof tiles !== "number" || !Number.isFinite(tiles) || tiles < 0) {
    throw new Error(`Invalid num_land_tiles in ${map} manifest: ${tiles}`);
  }
  landTilesCache.set(map, tiles);
  return tiles;
}

// Gets the number of land tiles for a map, falling back to 1,000,000.
export async function getMapLandTiles(map: GameMapType): Promise<number> {
  try {
    return await readMapLandTiles(map);
  } catch (error) {
    log.error(`Failed to load manifest for ${map}: ${error}`, { map });
    return 1_000_000; // Default fallback
  }
}
