import { GameMapLoader } from "@openfront/engine-api/game/GameMapLoader";
import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import {
  loadMapFiles,
  mapFilesLoader,
  mapFilesTransfer,
} from "@openfront/engine-lib/game/MapFiles";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "../../perf/fullgame/NodeGameMapLoader";

const maps = new NodeGameMapLoader(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../resources/maps",
  ),
);

/** The map loadTerrainMap builds, as plain data to compare. */
async function terrain(
  loader: GameMapLoader,
  map: GameMapType,
  size: GameMapSize,
) {
  const t = await loadTerrainMap(map, size, loader, false, true);
  const bytes = (m: typeof t.gameMap) =>
    Array.from({ length: m.width() * m.height() }, (_, i) => m.terrainByte(i));
  return {
    width: t.gameMap.width(),
    numLandTiles: t.gameMap.numLandTiles(),
    game: bytes(t.gameMap),
    mini: bytes(t.miniGameMap),
    nations: t.nations,
  };
}

describe("MapFiles", () => {
  for (const size of [GameMapSize.Normal, GameMapSize.Compact]) {
    test(`the passed files build the same ${size} map as loading it`, async () => {
      const files = await loadMapFiles(maps, GameMapType.Onion, size);
      expect(
        await terrain(mapFilesLoader(files), GameMapType.Onion, size),
      ).toEqual(await terrain(maps, GameMapType.Onion, size));
    });
  }

  test("only the bins the size reads are loaded and moved", async () => {
    const normal = await loadMapFiles(
      maps,
      GameMapType.Onion,
      GameMapSize.Normal,
    );
    expect(normal.map16xBin).toBeUndefined();
    expect(mapFilesTransfer(normal)).toEqual([
      normal.mapBin!.buffer,
      normal.map4xBin!.buffer,
    ]);
    const compact = await loadMapFiles(
      maps,
      GameMapType.Onion,
      GameMapSize.Compact,
    );
    expect(compact.mapBin).toBeUndefined();
    expect(mapFilesTransfer(compact)).toEqual([
      compact.map4xBin!.buffer,
      compact.map16xBin!.buffer,
    ]);
  });

  test("asking for another map or a bin that wasn't passed fails", async () => {
    const files = await loadMapFiles(
      maps,
      GameMapType.Onion,
      GameMapSize.Compact,
    );
    const loader = mapFilesLoader(files);
    expect(() => loader.getMapData(GameMapType.World)).toThrow(/only/);
    await expect(loader.getMapData(GameMapType.Onion).mapBin()).rejects.toThrow(
      /map\.bin/,
    );
  });
});
