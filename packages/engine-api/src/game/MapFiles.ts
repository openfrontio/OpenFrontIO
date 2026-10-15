import { GameMapSize, GameMapType, TeamGameSpawnAreas } from "./GameTypes";

/**
 * The files one map needs at one size, already loaded: the engine gets
 * these in its init message and never fetches. Normal games use map.bin
 * and map4x.bin, compact ones map4x.bin and map16x.bin.
 */
export interface MapFiles {
  map: GameMapType;
  mapSize: GameMapSize;
  manifest: MapManifest;
  mapBin?: Uint8Array;
  map4xBin?: Uint8Array;
  map16xBin?: Uint8Array;
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
