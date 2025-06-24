import { GameMapType } from "./Game";
import { MapManifest } from "./TerrainMapLoader";

interface MapData {
  mapBin: () => Promise<string>;
  miniMapBin: () => Promise<string>;
  manifest: () => Promise<MapManifest>;
  webpPath: () => Promise<string>;
}

export interface BinModule {
  default: string;
}

interface NationMapModule {
  default: MapManifest;
}

class GameMapLoader {
  private maps: Map<GameMapType, MapData>;

  constructor() {
    this.maps = new Map<GameMapType, MapData>();
  }

  private createLazyLoader<T>(importFn: () => Promise<T>): () => Promise<T> {
    let cache: Promise<T> | null = null;
    return () => {
      if (!cache) {
        cache = importFn();
      }
      return cache;
    };
  }

  public getMapData(map: GameMapType): MapData {
    const cachedMap = this.maps.get(map);
    if (cachedMap) {
      return cachedMap;
    }

    const key = Object.keys(GameMapType).find((k) => GameMapType[k] === map);
    const fileName = key?.toLowerCase();

    const mapData = {
      mapBin: this.createLazyLoader(() =>
        (
          import(
            `!!binary-loader!../../../resources/maps/${fileName}/map.bin`
          ) as Promise<BinModule>
        ).then((m) => m.default),
      ),
      miniMapBin: this.createLazyLoader(() =>
        (
          import(
            `!!binary-loader!../../../resources/maps/${fileName}/mini_map.bin`
          ) as Promise<BinModule>
        ).then((m) => m.default),
      ),
      manifest: this.createLazyLoader(() =>
        (
          import(
            `../../../resources/maps/${fileName}/manifest.json`
          ) as Promise<NationMapModule>
        ).then((m) => m.default),
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
}

export const terrainMapFileLoader = new GameMapLoader();
