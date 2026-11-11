import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { logger } from "./Logger";
import { readMapFile } from "./MapFiles";

const log = logger.child({ component: "MapLandTiles" });

const landTilesCache = new Map<GameMapType, number>();

// Gets the number of land tiles for a map.
export async function getMapLandTiles(map: GameMapType): Promise<number> {
  const cached = landTilesCache.get(map);
  if (cached !== undefined) return cached;

  try {
    const raw = (await readMapFile(map, "manifest.json")).toString("utf8");
    const tiles = (JSON.parse(raw) as { map: { num_land_tiles: number } }).map
      .num_land_tiles;
    landTilesCache.set(map, tiles);
    return tiles;
  } catch (error) {
    log.error(`Failed to load manifest for ${map}: ${error}`, { map });
    return 1_000_000; // Default fallback
  }
}
