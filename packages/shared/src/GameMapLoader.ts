import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { MapFiles, MapManifest } from "@openfront/engine-api/game/MapFiles";

/** Where a host gets a map's files, its thumbnail and its layer images. */
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

/** Loads the files a game on this map and size reads (see MapFiles). */
export async function loadMapFiles(
  loader: GameMapLoader,
  map: GameMapType,
  mapSize: GameMapSize,
): Promise<MapFiles> {
  const data = loader.getMapData(map);
  if (mapSize === GameMapSize.Normal) {
    const [manifest, mapBin, map4xBin] = await Promise.all([
      data.manifest(),
      data.mapBin(),
      data.map4xBin(),
    ]);
    return { map, mapSize, manifest, mapBin, map4xBin };
  }
  const [manifest, map4xBin, map16xBin] = await Promise.all([
    data.manifest(),
    data.map4xBin(),
    data.map16xBin(),
  ]);
  return { map, mapSize, manifest, map4xBin, map16xBin };
}

/** The files' buffers, to move them to a worker instead of copying them. */
export function mapFilesTransfer(files: MapFiles): ArrayBuffer[] {
  return [files.mapBin, files.map4xBin, files.map16xBin].flatMap((bin) =>
    bin === undefined ? [] : [bin.buffer as ArrayBuffer],
  );
}
