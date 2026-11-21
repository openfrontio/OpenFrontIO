import {
  CustomGameMap,
  GameMapId,
  GameMapSize,
} from "@openfront/engine-api/game/GameTypes";
import { MapManifest } from "@openfront/engine-api/game/MapManifest";
import {
  loadTerrainMap,
  TerrainMapData,
} from "@openfront/engine-lib/game/TerrainMapLoader";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { FetchGameMapLoader } from "@openfront/shared/FetchGameMapLoader";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";

export const terrainMapFileLoader = new FetchGameMapLoader((path) =>
  assetUrl(`maps/${path}`),
);

const terrainMaps = new Map<string, TerrainMapData>();
const manifests = new Map<GameMapId, Promise<MapManifest>>();

/**
 * A map's manifest, fetched once. The Custom map's is not kept: it is the
 * loaded scenario's (FetchGameMapLoader.setCustomMap), which changes.
 */
export function loadCachedManifest(map: GameMapId): Promise<MapManifest> {
  if (map === CustomGameMap) {
    return terrainMapFileLoader.getMapData(map).manifest();
  }
  let manifest = manifests.get(map);
  if (manifest === undefined) {
    manifest = terrainMapFileLoader.getMapData(map).manifest();
    manifest.catch(() => manifests.delete(map));
    manifests.set(map, manifest);
  }
  return manifest;
}

/**
 * The maps the client draws on, built once per map and size, but each time
 * for the Custom map, whose files change with the scenario.
 */
export async function loadCachedTerrainMap(
  map: GameMapId,
  mapSize: GameMapSize,
): Promise<TerrainMapData> {
  if (map === CustomGameMap) {
    return loadTerrainMap(
      await loadMapFiles(terrainMapFileLoader, map, mapSize),
    );
  }
  const key = `${map}:${mapSize}`;
  const cached = terrainMaps.get(key);
  if (cached !== undefined) return cached;
  const terrain = await loadTerrainMap(
    await loadMapFiles(terrainMapFileLoader, map, mapSize),
  );
  terrainMaps.set(key, terrain);
  return terrain;
}
