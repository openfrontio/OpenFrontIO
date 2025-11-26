import { GameMapSize, GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  nations: Nation[];
  gameMap: GameMap;
  miniGameMap: GameMap;
  sharedStateBuffer?: SharedArrayBuffer;
  sharedDirtyBuffer?: SharedArrayBuffer;
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
  strength: number;
}

export async function loadTerrainMap(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
  sharedStateBuffer?: SharedArrayBuffer,
): Promise<TerrainMapData> {
  const useCache = sharedStateBuffer === undefined;
  const canUseSharedBuffers =
    typeof SharedArrayBuffer !== "undefined" &&
    typeof Atomics !== "undefined" &&
    typeof (globalThis as any).crossOriginIsolated === "boolean" &&
    (globalThis as any).crossOriginIsolated === true;

  // Don't use cache if we can create SharedArrayBuffer but none was provided
  const shouldUseCache = useCache && !canUseSharedBuffers;

  if (shouldUseCache) {
    const cached = loadedMaps.get(map);
    if (cached !== undefined) return cached;
  }
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();

  const stateBuffer =
    sharedStateBuffer ??
    (typeof SharedArrayBuffer !== "undefined" &&
    typeof Atomics !== "undefined" &&
    // crossOriginIsolated is only defined in browser contexts
    typeof (globalThis as any).crossOriginIsolated === "boolean" &&
    (globalThis as any).crossOriginIsolated === true
      ? new SharedArrayBuffer(
          manifest.map.width *
            manifest.map.height *
            Uint16Array.BYTES_PER_ELEMENT,
        )
      : undefined);

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          manifest.map,
          await mapFiles.mapBin(),
          stateBuffer,
        )
      : await genTerrainFromBin(manifest.map4x, await mapFiles.map4xBin());

  const miniMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x,
          await mapFiles.map4xBin(),
        )
      : await genTerrainFromBin(manifest.map16x, await mapFiles.map16xBin());

  if (mapSize === GameMapSize.Compact) {
    manifest.nations.forEach((nation) => {
      nation.coordinates = [
        Math.floor(nation.coordinates[0] / 2),
        Math.floor(nation.coordinates[1] / 2),
      ];
    });
  }

  const result: TerrainMapData = {
    nations: manifest.nations,
    gameMap: gameMap,
    miniGameMap: miniMap,
    sharedStateBuffer:
      typeof SharedArrayBuffer !== "undefined" &&
      stateBuffer instanceof SharedArrayBuffer
        ? stateBuffer
        : undefined,
    sharedDirtyBuffer: undefined, // populated by consumer when needed
  };
  // Only cache the result when caching is actually used (non-SAB path)
  if (shouldUseCache) {
    loadedMaps.set(map, result);
  }
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
  stateBuffer?: ArrayBufferLike,
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
    stateBuffer,
  );
}
