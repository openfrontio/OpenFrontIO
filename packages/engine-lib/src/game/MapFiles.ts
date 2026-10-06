import {
  GameMapLoader,
  MapFiles,
} from "@openfront/engine-api/game/GameMapLoader";
import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";

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

/** A loader that serves the given files and loads nothing. */
export function mapFilesLoader(files: MapFiles): GameMapLoader {
  const bin = (data: Uint8Array | undefined, name: string) => async () => {
    if (data === undefined) {
      throw new Error(`${name} of ${files.map} was not passed`);
    }
    return data;
  };
  return {
    getMapData(map) {
      if (map !== files.map) {
        throw new Error(`only ${files.map} was passed, not ${map}`);
      }
      return {
        manifest: async () => files.manifest,
        mapBin: bin(files.mapBin, "map.bin"),
        map4xBin: bin(files.map4xBin, "map4x.bin"),
        map16xBin: bin(files.map16xBin, "map16x.bin"),
        webpPath: "",
        layerPng: () => Promise.reject(new Error("map layers are not passed")),
      };
    },
  };
}
