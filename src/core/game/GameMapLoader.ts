import { GameMapType } from "./Game";
import { MapManifest } from "./TerrainMapLoader";

export interface GameMapLoader {
  getMapData(map: GameMapType): MapData;
}

export interface MapData {
  mapBin: () => Promise<Uint8Array>;
  map4xBin: () => Promise<Uint8Array>;
  map16xBin: () => Promise<Uint8Array>;
  obstaclesBin?: () => Promise<Uint8Array | null>;
  obstacles4xBin?: () => Promise<Uint8Array | null>;
  obstacles16xBin?: () => Promise<Uint8Array | null>;
  manifest: () => Promise<MapManifest>;
  webpPath: () => Promise<string>;
}
