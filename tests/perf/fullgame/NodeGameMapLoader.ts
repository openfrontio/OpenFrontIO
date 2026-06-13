import fs from "fs";
import path from "path";
import { GameMapType } from "../../../src/core/game/Game";
import { GameMapLoader, MapData } from "../../../src/core/game/GameMapLoader";
import { MapManifest } from "../../../src/core/game/TerrainMapLoader";

/**
 * Loads real production maps from resources/maps/ via the filesystem,
 * mirroring how BinaryLoaderGameMapLoader resolves map directories.
 */
export class NodeGameMapLoader implements GameMapLoader {
  constructor(private mapsDir: string) {}

  getMapData(map: GameMapType): MapData {
    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    if (key === undefined) {
      throw new Error(`unknown map: ${map}`);
    }
    const dir = path.join(this.mapsDir, key.toLowerCase());
    const readBin = (name: string) => async () =>
      new Uint8Array(fs.readFileSync(path.join(dir, name)));
    return {
      mapBin: readBin("map.bin"),
      map4xBin: readBin("map4x.bin"),
      map16xBin: readBin("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: path.join(dir, "thumbnail.webp"),
    };
  }
}
