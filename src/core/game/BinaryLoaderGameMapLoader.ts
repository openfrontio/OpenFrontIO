import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";
import { MapManifest } from "./TerrainMapLoader";

interface NationMapModule {
  default: MapManifest;
}

export class BinaryLoaderGameMapLoader implements GameMapLoader {
  private maps: Map<GameMapType, MapData>;

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

    const loadBinary = (url: string) =>
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load ${url}`);
          return res.arrayBuffer();
        })
        .then((buf) => new Uint8Array(buf));

    const mapData = {
      mapBin: this.createLazyLoader(() =>
        import(`../../../resources/maps/${fileName}/map.bin?url`).then((m) =>
          loadBinary(m.default),
        ),
      ),
      map4xBin: this.createLazyLoader(() =>
        import(`../../../resources/maps/${fileName}/map4x.bin?url`).then((m) =>
          loadBinary(m.default),
        ),
      ),
      map16xBin: this.createLazyLoader(() =>
        import(`../../../resources/maps/${fileName}/map16x.bin?url`).then((m) =>
          loadBinary(m.default),
        ),
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
