import { GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

export type TerrainMapData = {
  nationMap: NationMap;
  gameMap: GameMap;
  miniGameMap: GameMap;
};

const loadedMaps = new Map<GameMapType, TerrainMapData>();

export interface NationMap {
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
  const mapFiles = await terrainMapFileLoader.getMapData(map);

  const gameMap = await genTerrainFromBin(mapFiles.mapBin);
  const miniGameMap = await genTerrainFromBin(mapFiles.miniMapBin);
  const result = {
    nationMap: mapFiles.nationMap,
    gameMap: gameMap,
    miniGameMap: miniGameMap,
  };
  loadedMaps.set(map, result);
  return result;
}

export async function genTerrainFromBin(data: string): Promise<GameMap> {
  const width = (data.charCodeAt(1) << 8) | data.charCodeAt(0);
  const height = (data.charCodeAt(3) << 8) | data.charCodeAt(2);

  if (data.length !== width * height + 4) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${width}x${height} terrain plus 4 bytes for dimensions.`,
    );
  }

  // Store raw data in Uint8Array
  const rawData = new Uint8Array(width * height);
  let numLand = 0;

  // Copy data starting after the header
  for (let i = 0; i < width * height; i++) {
    const packedByte = data.charCodeAt(i + 4);
    rawData[i] = packedByte;
    if (packedByte & 0b10000000) numLand++;
  }

  return new GameMapImpl(width, height, rawData, numLand);
}

function logBinaryAsAscii(data: string, length: number = 8) {
  console.log("Binary data (1 = set bit, 0 = unset bit):");
  for (let i = 0; i < Math.min(length, data.length); i++) {
    const byte = data.charCodeAt(i);
    let byteString = "";
    for (let j = 7; j >= 0; j--) {
      byteString += byte & (1 << j) ? "1" : "0";
    }
    console.log(`Byte ${i}: ${byteString}`);
  }
}
