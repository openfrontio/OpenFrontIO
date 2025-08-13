import { GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

export type TerrainMapData = {
  manifest: MapManifest;
  gameMap: GameMap;
  miniGameMap: GameMap;
};

const loadedMaps = new Map<GameMapType, TerrainMapData>();

export interface MapMetadata {
  width: number;
  height: number;
  num_land_tiles: number;
}

export interface MapManifest {
  name: string;
  map: MapMetadata;
  mini_map: MapMetadata;
  nations: Nation[];
}

export interface Nation {
  coordinates: [number, number];
  flag: string;
  name: string;
  strength: number;
}

export async function loadTerrainMap(
  map: GameMapType,
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
    manifest: await mapFiles.manifest(),
    gameMap: gameMap,
    miniGameMap: miniGameMap,
  };
  loadedMaps.set(map, result);
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: string,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }

  // Store raw data in Uint8Array
  const rawData = new Uint8Array(mapData.width * mapData.height);

  // Copy data starting after the header
  for (let i = 0; i < mapData.width * mapData.height; i++) {
    const packedByte = data.charCodeAt(i);
    rawData[i] = packedByte;
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    rawData,
    mapData.num_land_tiles,
  );
}
