import { GameMapSize, GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  nations: Nation[];
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
  map4x: MapMetadata;
  map16x: MapMetadata;
  nations: Nation[];
}

export interface Nation {
  coordinates: [number, number];
  flag: string;
  name: string;
}

export async function loadTerrainMap(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
): Promise<TerrainMapData> {
  const cached = loadedMaps.get(map);
  if (cached !== undefined) return cached;
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();

  const [
    mapBin,
    map4xBin,
    map16xBin,
    obstaclesBin,
    obstacles4xBin,
    obstacles16xBin,
  ] = await Promise.all([
    mapFiles.mapBin(),
    mapFiles.map4xBin(),
    mapFiles.map16xBin(),
    mapFiles.obstaclesBin?.(),
    mapFiles.obstacles4xBin?.(),
    mapFiles.obstacles16xBin?.(),
  ]);

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(manifest.map, mapBin, obstaclesBin ?? undefined)
      : await genTerrainFromBin(
          manifest.map4x,
          map4xBin,
          obstacles4xBin ?? undefined,
        );

  const miniMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x,
          map4xBin,
          obstacles4xBin ?? undefined,
        )
      : await genTerrainFromBin(
          manifest.map16x,
          map16xBin,
          obstacles16xBin ?? undefined,
        );

  if (mapSize === GameMapSize.Compact) {
    manifest.nations.forEach((nation) => {
      nation.coordinates = [
        Math.floor(nation.coordinates[0] / 2),
        Math.floor(nation.coordinates[1] / 2),
      ];
    });
  }

  const result = {
    nations: manifest.nations,
    gameMap: gameMap,
    miniGameMap: miniMap,
  };
  loadedMaps.set(map, result);
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
  obstacles?: Uint8Array,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }
  if (obstacles && obstacles.length !== mapData.width * mapData.height) {
    console.warn(
      `Ignoring obstacle data: buffer size ${obstacles.length} incorrect for ${mapData.width}x${mapData.height}.`,
    );
    obstacles = undefined;
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
    obstacles,
  );
}
