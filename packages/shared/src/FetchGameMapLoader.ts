import {
  CustomGameMap,
  GameMapId,
  GameMapType,
} from "@openfront/engine-api/game/GameTypes";
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { GameMapLoader, MapData } from "./GameMapLoader";

export class FetchGameMapLoader implements GameMapLoader {
  private maps: Map<GameMapId, MapData>;
  private custom: MapData | null = null;

  public constructor(
    private readonly pathResolver: string | ((path: string) => string),
  ) {
    this.maps = new Map<GameMapId, MapData>();
  }

  /**
   * Answers for the Custom map from a loaded scenario bundle's files and
   * thumbnail (docs/ScenarioEditor.md, "Custom map identity"), until the
   * next bundle. Each load gets its own copy of a file: a game takes over
   * the files it loads, and a worker is sent them by transfer.
   */
  public setCustomMap(files: MapFiles, webpPath: string): void {
    const copy = (bin: Uint8Array | undefined) => async () => {
      if (bin === undefined) throw new Error("the scenario lacks a map file");
      return bin.slice();
    };
    this.custom = {
      mapBin: copy(files.mapBin),
      map4xBin: copy(files.map4xBin),
      map16xBin: copy(files.map16xBin),
      manifest: async () => structuredClone(files.manifest),
      webpPath,
      layerImage: async () => {
        throw new Error("a scenario's map has no layers");
      },
    };
  }

  public getMapData(map: GameMapId): MapData {
    if (map === CustomGameMap) {
      if (this.custom === null) throw new Error("no scenario is loaded");
      return this.custom;
    }
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
      mapBin: () => this.loadBinaryFromUrl(this.url(fileName, "map.bin")),
      map4xBin: () => this.loadBinaryFromUrl(this.url(fileName, "map4x.bin")),
      map16xBin: () => this.loadBinaryFromUrl(this.url(fileName, "map16x.bin")),
      manifest: () => this.loadJsonFromUrl(this.url(fileName, "manifest.json")),
      webpPath: this.url(fileName, "thumbnail.webp"),
      layerImage: (layerId: string, compact: boolean) =>
        this.loadImageBitmap(
          this.url(fileName, `${layerId}${compact ? ".4x" : ""}.webp`),
        ),
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }

  private resolveUrl(path: string): string {
    if (typeof this.pathResolver === "function") {
      return this.pathResolver(path);
    }
    return `${this.pathResolver}/${path}`;
  }

  private url(map: string, path: string) {
    return this.resolveUrl(`${map}/${path}`);
  }

  private async loadBinaryFromUrl(url: string) {
    const startTime = performance.now();
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    console.log(
      `[MapLoader] ${url}: ${(performance.now() - startTime).toFixed(0)}ms`,
    );
    return new Uint8Array(data);
  }

  private async loadJsonFromUrl(url: string) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }

    return response.json();
  }

  private async loadImageBitmap(url: string): Promise<ImageBitmap> {
    const startTime = performance.now();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    console.log(
      `[MapLoader] ${url}: ${(performance.now() - startTime).toFixed(0)}ms`,
    );
    return bitmap;
  }
}
