import { GameMapType } from "./Game";
import { MapManifest } from "./TerrainMapLoader";

export interface GameMapLoader {
  getMapData(map: GameMapType): MapData;
}

export interface MapData {
  mapBin: () => Promise<Uint8Array>;
  miniMapBin: () => Promise<Uint8Array>;
  manifest: () => Promise<MapManifest>;
  webpPath: () => Promise<string>;
}
