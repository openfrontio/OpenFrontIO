import { consolex } from "../Consolex";
import { GameMapType } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";

const loadedMaps = new Map<
  GameMapType,
  { nationMap: NationMap; gameMap: GameMap; miniGameMap: GameMap }
>();

export interface NationMap {
  name: string;
  width: number;
  height: number;
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
): Promise<{ nationMap: NationMap; gameMap: GameMap; miniGameMap: GameMap }> {
  if (loadedMaps.has(map)) {
    return loadedMaps.get(map);
  }
  const mapFiles = await terrainMapFileLoader.getMapData(map);

  const gameMap = await loadTerrainFromFile(mapFiles.mapBin);
  const miniGameMap = await loadTerrainFromFile(mapFiles.miniMapBin);
  const result = {
    nationMap: mapFiles.nationMap,
    gameMap: gameMap,
    miniGameMap: miniGameMap,
  };
  loadedMaps.set(map, result);
  return result;
}

export async function loadTerrainFromFile(fileData: string): Promise<GameMap> {
  const width = (fileData.charCodeAt(1) << 8) | fileData.charCodeAt(0);
  const height = (fileData.charCodeAt(3) << 8) | fileData.charCodeAt(2);

  if (fileData.length != width * height + 4) {
    throw new Error(
      `Invalid data: buffer size ${fileData.length} incorrect for ${width}x${height} terrain plus 4 bytes for dimensions.`,
    );
  }

  // Store raw data in Uint8Array
  const rawData = new Uint8Array(width * height);
  let numLand = 0;

  // Copy data starting after the header
  for (let i = 0; i < width * height; i++) {
    const packedByte = fileData.charCodeAt(i + 4);
    rawData[i] = packedByte;
    if (packedByte & 0b10000000) numLand++;
  }

  return new GameMapImpl(width, height, rawData, numLand);
}

function logBinaryAsAscii(data: string, length: number = 8) {
  consolex.log("Binary data (1 = set bit, 0 = unset bit):");
  for (let i = 0; i < Math.min(length, data.length); i++) {
    let byte = data.charCodeAt(i);
    let byteString = "";
    for (let j = 7; j >= 0; j--) {
      byteString += byte & (1 << j) ? "1" : "0";
    }
    consolex.log(`Byte ${i}: ${byteString}`);
  }
}
