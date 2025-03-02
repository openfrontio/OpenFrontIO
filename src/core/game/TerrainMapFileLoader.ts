import { GameMapType } from "./Game";
import { NationMap } from "./TerrainMapLoader";

interface MapData {
  mapBin: string;
  miniMapBin: string;
  nationMap: NationMap;
}

interface MapCache {
  bin?: string;
  miniMapBin?: string;
  nationMap?: NationMap;
}

interface BinModule {
  default: string;
}

interface NationMapModule {
  default: NationMap;
}

// Mapping from GameMap enum values to file names
const MAP_FILE_NAMES: Record<GameMapType, string> = {
  [GameMapType.World]: "WorldMap",
  [GameMapType.Europe]: "Europe",
  [GameMapType.Mena]: "Mena",
  [GameMapType.NorthAmerica]: "NorthAmerica",
  [GameMapType.Oceania]: "Oceania",
  [GameMapType.BlackSea]: "BlackSea",
  [GameMapType.Africa]: "Africa",
  [GameMapType.Asia]: "Asia",
  [GameMapType.Mars]: "Mars",
};

class GameMapLoader {
  private maps: Map<GameMapType, MapCache>;
  private loadingPromises: Map<GameMapType, Promise<MapData>>;

  constructor() {
    this.maps = new Map<GameMapType, MapCache>();
    this.loadingPromises = new Map<GameMapType, Promise<MapData>>();
  }

  public async getMapData(map: GameMapType): Promise<MapData> {
    const cachedMap = this.maps.get(map);
    if (cachedMap?.bin && cachedMap?.nationMap) {
      return cachedMap as MapData;
    }

    if (!this.loadingPromises.has(map)) {
      this.loadingPromises.set(map, this.loadMapData(map));
    }

    const data = await this.loadingPromises.get(map)!;
    this.maps.set(map, data);
    return data;
  }

  private async loadMapData(map: GameMapType): Promise<MapData> {
    const fileName = MAP_FILE_NAMES[map];
    if (!fileName) {
      throw new Error(`No file name mapping found for map: ${map}`);
    }

    const [binModule, miniBinModule, infoModule] = await Promise.all([
      import(
        `!!binary-loader!../../../resources/maps/${fileName}.bin`
      ) as Promise<BinModule>,
      import(
        `!!binary-loader!../../../resources/maps/${fileName}Mini.bin`
      ) as Promise<BinModule>,
      import(
        `../../../resources/maps/${fileName}.json`
      ) as Promise<NationMapModule>,
    ]);

    return {
      mapBin: binModule.default,
      miniMapBin: miniBinModule.default,
      nationMap: infoModule.default,
    };
  }

  public isMapLoaded(map: GameMapType): boolean {
    const mapData = this.maps.get(map);
    return !!mapData?.bin && !!mapData?.nationMap;
  }

  public getLoadedMaps(): GameMapType[] {
    return Array.from(this.maps.keys()).filter((map) => this.isMapLoaded(map));
  }
}

export const terrainMapFileLoader = new GameMapLoader();
