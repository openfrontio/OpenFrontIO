import { z } from "zod";
import { GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  manifest: MapManifest;
  gameMap: GameMap;
  miniGameMap: GameMap;
};

const loadedMaps = new Map<GameMapType, TerrainMapData>();

export const MapMetadataSchema = z.object({
  height: z.number(),
  num_land_tiles: z.number(),
  width: z.number(),
});
export type MapMetadata = z.infer<typeof MapMetadataSchema>;

export const NationSchema = z.object({
  coordinates: z.tuple([z.number(), z.number()]),
  flag: z.string(),
  name: z.string(),
  strength: z.number(),
});
export type Nation = z.infer<typeof NationSchema>;

export const MapManifestSchema = z.object({
  map: MapMetadataSchema,
  mini_map: MapMetadataSchema,
  name: z.string(),
  nations: NationSchema.array(),
});
export type MapManifest = z.infer<typeof MapManifestSchema>;

export async function loadTerrainMap(
  map: GameMapType,
  terrainMapFileLoader: GameMapLoader,
): Promise<TerrainMapData> {
  const cached = loadedMaps.get(map);
  if (cached !== undefined) return cached;
  const mapFiles = terrainMapFileLoader.getMapData(map);

  const manifest = await mapFiles.manifest();
  const gameMap = await genTerrainFromBin(
    manifest.map,
    await mapFiles.mapBin(),
  );
  const miniGameMap = await genTerrainFromBin(
    manifest.mini_map,
    await mapFiles.miniMapBin(),
  );
  const result = {
    gameMap,
    manifest: await mapFiles.manifest(),
    miniGameMap,
  };
  loadedMaps.set(map, result);
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${
        mapData.height
      } terrain plus 4 bytes for dimensions.`,
    );
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
  );
}
