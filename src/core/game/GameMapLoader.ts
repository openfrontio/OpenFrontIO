import { GameMapType } from "./Game";
import { MapManifest } from "./TerrainMapLoader";

export type GameMapLoader = {
  getMapData(map: GameMapType): MapData;
};

export type MapData = {
  mapBin: () => Promise<Uint8Array>;
  miniMapBin: () => Promise<Uint8Array>;
  manifest: () => Promise<MapManifest>;
  webpPath: () => Promise<string>;
};
