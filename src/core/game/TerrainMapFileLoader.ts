import { GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { getMapFileName } from "./MapRegistry";

export type TerrainMapData = {
  nationMap: NationMap;
  gameMap: GameMap;
  miniGameMap: GameMap;
};

const loadedMapsCache = new Map<GameMapType, TerrainMapData>();

export interface NationMap {
  nations: Nation[];
}

export interface Nation {
  coordinates: [number, number];
  flag: string;
  name: string;
  strength: number;
}

interface MapData {
  mapBin: string;
  miniMapBin: string;
  nationMap: NationMap;
}

interface MapCache {
  bin?: string;
  miniMapBin?: string;
  nationMap?: NationMap;
}

interface BinModule {
  default: string;
}

interface NationMapModule {
  default: NationMap;
}

class GameMapLoader {
  private maps: Map<GameMapType, MapCache>;
  private loadingPromises: Map<GameMapType, Promise<MapData>>;

  constructor() {
    this.maps = new Map<GameMapType, MapCache>();
    this.loadingPromises = new Map<GameMapType, Promise<MapData>>();
  }

  public async getMapData(map: GameMapType): Promise<MapData> {
    const cachedMap = this.maps.get(map);
    if (cachedMap?.bin && cachedMap?.nationMap) {
      return cachedMap as MapData;
    }

    if (!this.loadingPromises.has(map)) {
      this.loadingPromises.set(map, this.loadMapData(map));
    }

    const data = await this.loadingPromises.get(map)!;
    this.maps.set(map, data);
    return data;
  }

  private async loadMapData(map: GameMapType): Promise<MapData> {
    const fileName = getMapFileName(map); // Use helper function to get correct filename
    if (!fileName) {
      throw new Error(`No file name mapping found for map: ${map}`);
    }

    const [binModule, miniBinModule, infoModule] = await Promise.all([
      import(
        `!!binary-loader!../../../resources/maps/${fileName}.bin`
      ) as Promise<BinModule>,
      import(
        `!!binary-loader!../../../resources/maps/${fileName}Mini.bin`
      ) as Promise<BinModule>,
      import(
        `../../../resources/maps/${fileName}.json`
      ) as Promise<NationMapModule>,
    ]);

    return {
      mapBin: binModule.default,
      miniMapBin: miniBinModule.default,
      nationMap: infoModule.default,
    };
  }

  public isMapLoaded(map: GameMapType): boolean {
    const mapData = this.maps.get(map);
    return !!mapData?.bin && !!mapData?.nationMap && !!mapData?.miniMapBin;
  }

  public getLoadedMaps(): GameMapType[] {
    return Array.from(this.maps.keys()).filter((map) => this.isMapLoaded(map));
  }
}

export const terrainMapFileLoaderInstance = new GameMapLoader();

export async function loadTerrainMap(
  map: GameMapType,
): Promise<TerrainMapData> {
  if (loadedMapsCache.has(map)) {
    return loadedMapsCache.get(map)!;
  }

  if (!terrainMapFileLoaderInstance) {
    throw new Error(
      "Internal Error: terrainMapFileLoaderInstance is not initialized!",
    );
  }
  const mapFiles = await terrainMapFileLoaderInstance.getMapData(map);

  const gameMap = await genTerrainFromBin(mapFiles.mapBin);
  const miniGameMap = await genTerrainFromBin(mapFiles.miniMapBin);
  const result = {
    nationMap: mapFiles.nationMap,
    gameMap: gameMap,
    miniGameMap: miniGameMap,
  };
  loadedMapsCache.set(map, result);
  return result;
}

export async function genTerrainFromBin(data: string): Promise<GameMap> {
  const width = (data.charCodeAt(1) << 8) | data.charCodeAt(0);
  const height = (data.charCodeAt(3) << 8) | data.charCodeAt(2);

  const expectedLength = width * height + 4;
  if (data.length !== expectedLength) {
    console.error(
      `Data length mismatch: expected ${expectedLength}, got ${data.length} for ${width}x${height}`,
    );
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${width}x${height} terrain plus 4 bytes for dimensions.`,
    );
  }

  const rawData = new Uint8Array(width * height);
  let numLand = 0;

  for (let i = 0; i < width * height; i++) {
    const packedByte = data.charCodeAt(i + 4);
    if (isNaN(packedByte)) {
      console.error(
        `NaN encountered at index ${i + 4} when reading char code.`,
      );
      throw new Error(`Invalid character data encountered at index ${i + 4}`);
    }
    rawData[i] = packedByte;
    if ((packedByte & 0b10000000) !== 0) {
      numLand++;
    }
  }

  return new GameMapImpl(width, height, rawData, numLand);
}
