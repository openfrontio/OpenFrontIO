import { GameMap } from "@openfront/engine-api/game/GameMap";
import {
  GameMapSize,
  TeamGameSpawnAreas,
} from "@openfront/engine-api/game/GameTypes";
import {
  AdditionalNation,
  MapFiles,
  MapLayer,
  MapMetadata,
  Nation,
} from "@openfront/engine-api/game/MapFiles";
import { GameMapImpl } from "./GameMapImpl";

export type TerrainMapData = {
  nations: Nation[];
  additionalNations: AdditionalNation[];
  gameMap: GameMap;
  miniGameMap: GameMap;
  teamGameSpawnAreas?: TeamGameSpawnAreas;
  /** Map layers from the manifest, if any. */
  layers?: MapLayer[];
};

/**
 * Builds the maps from a map's files, which it takes over: the maps keep
 * the bins as their terrain and compact maps scale the manifest in place.
 * Pass files nothing else reads.
 */
export async function loadTerrainMap(files: MapFiles): Promise<TerrainMapData> {
  const { map, mapSize, manifest } = files;
  const bin = (data: Uint8Array | undefined, name: string) => {
    if (data === undefined) throw new Error(`${name} of ${map} was not passed`);
    return data;
  };

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(manifest.map, bin(files.mapBin, "map.bin"))
      : await genTerrainFromBin(
          manifest.map4x,
          bin(files.map4xBin, "map4x.bin"),
        );

  const miniMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          manifest.map4x,
          bin(files.map4xBin, "map4x.bin"),
        )
      : await genTerrainFromBin(
          manifest.map16x,
          bin(files.map16xBin, "map16x.bin"),
        );

  if (mapSize === GameMapSize.Compact) {
    manifest.nations.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
    manifest.additionalNations?.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
  }

  // Scale spawn areas for compact maps
  let teamGameSpawnAreas = manifest.teamGameSpawnAreas;
  if (mapSize === GameMapSize.Compact && teamGameSpawnAreas) {
    const scaled: TeamGameSpawnAreas = {};
    for (const [key, areas] of Object.entries(teamGameSpawnAreas)) {
      scaled[key] = areas.map((a) => ({
        x: Math.floor(a.x / 2),
        y: Math.floor(a.y / 2),
        width: Math.max(1, Math.floor(a.width / 2)),
        height: Math.max(1, Math.floor(a.height / 2)),
      }));
    }
    teamGameSpawnAreas = scaled;
  }

  const layers = manifest.layers;

  // Validate layer placements and alpha at game start.
  if (layers) {
    for (const layer of layers) {
      if (layer.placement !== "land" && layer.placement !== "water") {
        throw new Error(
          `Map ${map}: layer "${layer.id}" has invalid placement "${layer.placement}" (must be "land" or "water")`,
        );
      }
      if (
        layer.alpha !== undefined &&
        (!Number.isFinite(layer.alpha) || layer.alpha < 0 || layer.alpha > 1)
      ) {
        throw new Error(
          `Map ${map}: layer "${layer.id}" has invalid alpha ${layer.alpha} (must be a finite number between 0 and 1)`,
        );
      }
    }
  }

  return {
    nations: manifest.nations,
    additionalNations: manifest.additionalNations ?? [],
    gameMap: gameMap,
    miniGameMap: miniMap,
    teamGameSpawnAreas,
    layers,
  };
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
  );
}
