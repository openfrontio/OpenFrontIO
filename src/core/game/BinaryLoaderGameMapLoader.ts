import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";
import { MapManifest } from "./TerrainMapLoader";

export type BinModule = {
  default: string;
};

type NationMapModule = {
  default: MapManifest;
};

export class BinaryLoaderGameMapLoader implements GameMapLoader {
  private readonly maps: Map<GameMapType, MapData>;

  constructor() {
    this.maps = new Map<GameMapType, MapData>();
  }

  private createLazyLoader<T>(importFn: () => Promise<T>): () => Promise<T> {
    let cache: Promise<T> | null = null;
    return () => {
      cache ??= importFn();
      return cache;
    };
  }

  getMapData(map: GameMapType): MapData {
    const cachedMap = this.maps.get(map);
    if (cachedMap) {
      return cachedMap;
    }

    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    const fileName = key?.toLowerCase();

    const mapData = {
      manifest: this.createLazyLoader(() =>
        (
          import(
            `../../../resources/maps/${fileName}/manifest.json`
          ) as Promise<NationMapModule>
        ).then((m) => m.default),
      ),
      mapBin: this.createLazyLoader(() =>
        (
          import(
            `!!binary-loader!../../../resources/maps/${fileName}/map.bin`
          ) as Promise<BinModule>
        ).then((m) => this.toUInt8Array(m.default)),
      ),
      miniMapBin: this.createLazyLoader(() =>
        (
          import(
            `!!binary-loader!../../../resources/maps/${fileName}/mini_map.bin`
          ) as Promise<BinModule>
        ).then((m) => this.toUInt8Array(m.default)),
      ),
      webpPath: this.createLazyLoader(() =>
        (
          import(
            `../../../resources/maps/${fileName}/thumbnail.webp`
          ) as Promise<{ default: string }>
        ).then((m) => m.default),
      ),
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }

  /**
   * Converts a given string into a UInt8Array where each character in the string
   * is represented as an 8-bit unsigned integer.
   */
  private toUInt8Array(data: string) {
    const rawData = new Uint8Array(data.length);

    for (let i = 0; i < data.length; i++) {
      rawData[i] = data.charCodeAt(i);
    }

    return rawData;
  }
}
