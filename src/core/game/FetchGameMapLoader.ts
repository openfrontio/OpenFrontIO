import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";
import { MapManifestSchema } from "./TerrainMapLoader";

export class FetchGameMapLoader implements GameMapLoader {
  private readonly maps: Map<GameMapType, MapData>;

  public constructor(
    private readonly prefix: string,
    private readonly cacheBuster?: string,
  ) {
    this.maps = new Map<GameMapType, MapData>();
  }

  public getMapData(map: GameMapType): MapData {
    const cachedMap = this.maps.get(map);
    if (cachedMap) {
      return cachedMap;
    }

    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    const fileName = key?.toLowerCase();

    if (!fileName) {
      throw new Error(`Unknown map: ${map}`);
    }

    const mapData = {
      manifest: () => this.loadJsonFromUrl(this.url(fileName, "manifest.json")),
      mapBin: () => this.loadBinaryFromUrl(this.url(fileName, "map.bin")),
      miniMapBin: () =>
        this.loadBinaryFromUrl(this.url(fileName, "mini_map.bin")),
      webpPath: async () => this.url(fileName, "thumbnail.webp"),
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }

  private url(map: string, path: string) {
    let url = `${this.prefix}/${map}/${path}`;

    if (this.cacheBuster) {
      url += `${url.includes("?") ? "&" : "?"}v=${this.cacheBuster}`;
    }

    return url;
  }

  private async loadBinaryFromUrl(url: string) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    return new Uint8Array(data);
  }

  private async loadJsonFromUrl(url: string) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }

    return response.json().then(MapManifestSchema.parse);
  }
}
