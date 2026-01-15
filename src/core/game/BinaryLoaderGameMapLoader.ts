import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";
import { MapManifest } from "./TerrainMapLoader";

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

    const loadOptionalBinary = (url: string) =>
      fetch(url).then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Failed to load ${url}`);
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("text/html")) {
          return null;
        }
        return res.arrayBuffer().then((buf) => new Uint8Array(buf));
      });

    const mapBasePath = `/maps/${fileName}`;

    const mapData = {
      mapBin: this.createLazyLoader(() => loadBinary(`${mapBasePath}/map.bin`)),
      map4xBin: this.createLazyLoader(() =>
        loadBinary(`${mapBasePath}/map4x.bin`),
      ),
      map16xBin: this.createLazyLoader(() =>
        loadBinary(`${mapBasePath}/map16x.bin`),
      ),
      obstaclesBin: this.createLazyLoader(() =>
        loadOptionalBinary(`${mapBasePath}/obstacles.bin`),
      ),
      obstacles4xBin: this.createLazyLoader(() =>
        loadOptionalBinary(`${mapBasePath}/obstacles4x.bin`),
      ),
      obstacles16xBin: this.createLazyLoader(() =>
        loadOptionalBinary(`${mapBasePath}/obstacles16x.bin`),
      ),
      manifest: this.createLazyLoader(() =>
        fetch(`${mapBasePath}/manifest.json`).then((res) => {
          if (!res.ok) {
            throw new Error(`Failed to load ${mapBasePath}/manifest.json`);
          }
          return res.json() as Promise<MapManifest>;
        }),
      ),
      webpPath: this.createLazyLoader(() =>
        Promise.resolve(`${mapBasePath}/thumbnail.webp`),
      ),
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }
}
