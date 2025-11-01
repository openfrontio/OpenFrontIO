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
  wrapHorizontally?: boolean;
  wrapVertically?: boolean;
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
  strength: number;
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

  // Default wrapping: horizontal is off by default, vertical is off by default.
  // Enable horizontal wrapping by default for large world-style maps (World, Mars).
  const defaultWrapHorizontally =
    map === GameMapType.World ||
    map === GameMapType.Mars ||
    map === GameMapType.GiantWorldMap ||
    map === GameMapType.Pangaea;
  const defaultWrapVertically = map === GameMapType.Pangaea;

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          manifest.map,
          await mapFiles.mapBin(),
          manifest.map.wrapHorizontally ?? defaultWrapHorizontally,
          manifest.map.wrapVertically ?? defaultWrapVertically,
        )
      : await genTerrainFromBin(
          manifest.map4x,
          await mapFiles.map4xBin(),
          manifest.map4x.wrapHorizontally ?? defaultWrapHorizontally,
          manifest.map4x.wrapVertically ?? defaultWrapVertically,
        );

  const miniMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          // For normal mapSize we show the 4x mini preview
          mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x,
          await mapFiles.map4xBin(),
          (mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x)
            .wrapHorizontally ?? defaultWrapHorizontally,
          (mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x)
            .wrapVertically ?? defaultWrapVertically,
        )
      : await genTerrainFromBin(
          manifest.map16x,
          await mapFiles.map16xBin(),
          manifest.map16x.wrapHorizontally ?? defaultWrapHorizontally,
          manifest.map16x.wrapVertically ?? defaultWrapVertically,
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
  wrapHorizontally: boolean = false,
  wrapVertically: boolean = false,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
    wrapHorizontally,
    wrapVertically,
  );
}
