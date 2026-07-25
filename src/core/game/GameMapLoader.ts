import { GameMapType } from "./Game";
import { MapManifest } from "./TerrainMapLoader";

export interface GameMapLoader {
  getMapData(map: GameMapType): MapData;
}

export interface MapData {
  mapBin: () => Promise<Uint8Array>;
  map4xBin: () => Promise<Uint8Array>;
  map16xBin: () => Promise<Uint8Array>;
  manifest: () => Promise<MapManifest>;
  webpPath: string;
  // Region rasters (region-based conquest). Only populated for maps in
  // REGION_ENABLED_MAPS; a fetch failure there must reject (determinism).
  regionsBin?: () => Promise<Uint8Array>;
  regions4xBin?: () => Promise<Uint8Array>;
}
