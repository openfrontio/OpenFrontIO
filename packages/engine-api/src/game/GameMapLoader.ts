import { GameMapType, TeamGameSpawnAreas } from "./GameTypes";

export interface GameMapLoader {
  getMapData(map: GameMapType): MapData;
}

export interface MapData {
  mapBin: () => Promise<Uint8Array>;
  map4xBin: () => Promise<Uint8Array>;
  map16xBin: () => Promise<Uint8Array>;
  manifest: () => Promise<MapManifest>;
  webpPath: string;
  /** Load a map layer PNG by layer id. Returns an ImageBitmap. */
  layerPng: (layerId: string) => Promise<ImageBitmap>;
}

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
  // Optional pool of fallback nation names used when a game requests more
  // nations than the manifest defines. Picked at random; if still not enough,
  // the remainder is generated procedurally.
  additionalNations?: AdditionalNation[];
  teamGameSpawnAreas?: TeamGameSpawnAreas;
  /** Optional map layers rendered between terrain and territory. */
  layers?: MapLayer[];
}

export type LayerPlacement = "land" | "water";

export interface MapLayer {
  /** Unique identifier — also the PNG filename (without extension). */
  id: string;
  /** Whether the layer sits on land or water tiles. */
  placement: LayerPlacement;
  /** If true, the layer is permanently destroyed in nuke impact radii. */
  nukeable?: boolean;
  /**
   * Default opacity for this layer (0–1). Used as the initial value for the
   * player's layer-alpha slider.  Omit to default to 1 (fully opaque).
   */
  alpha?: number;
}

export interface Nation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export interface AdditionalNation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}
