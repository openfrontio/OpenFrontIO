import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { createGameRunner } from "@openfront/engine/GameRunner";
import {
  loadMapFiles,
  mapFilesTransfer,
} from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "../../perf/fullgame/NodeGameMapLoader";
import { scriptedGameStart } from "../../util/ScriptedGame";

const maps = new NodeGameMapLoader(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../resources/maps",
  ),
);

describe("MapFiles", () => {
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

  test("each size builds its maps from its own bins", async () => {
    const normal = await loadMapFiles(
      maps,
      GameMapType.Onion,
      GameMapSize.Normal,
    );
    const { map, map4x, map16x } = normal.manifest;
    const normalNations = structuredClone(normal.manifest.nations);
    const n = await loadTerrainMap(normal);
    expect([n.gameMap.width(), n.gameMap.height()]).toEqual([
      map.width,
      map.height,
    ]);
    expect([n.miniGameMap.width(), n.miniGameMap.height()]).toEqual([
      map4x.width,
      map4x.height,
    ]);
    expect(n.nations).toEqual(normalNations);

    const c = await loadTerrainMap(
      await loadMapFiles(maps, GameMapType.Onion, GameMapSize.Compact),
    );
    expect([c.gameMap.width(), c.gameMap.height()]).toEqual([
      map4x.width,
      map4x.height,
    ]);
    expect([c.miniGameMap.width(), c.miniGameMap.height()]).toEqual([
      map16x.width,
      map16x.height,
    ]);
    // Compact maps are half the size, and so are the nations' positions.
    expect(c.nations.map((nation) => nation.coordinates)).toEqual(
      normalNations.map((nation) =>
        nation.coordinates?.map((v) => Math.floor(v / 2)),
      ),
    );
  });

  test("a bin the size reads but wasn't passed fails", async () => {
    const files = await loadMapFiles(
      maps,
      GameMapType.Onion,
      GameMapSize.Normal,
    );
    await expect(
      loadTerrainMap({ ...files, mapBin: undefined }),
    ).rejects.toThrow(/map\.bin of .* was not passed/);
  });

  test("a game doesn't start on another map's files", async () => {
    const start = scriptedGameStart({
      gameMap: GameMapType.Onion,
      gameMapSize: GameMapSize.Compact,
    });
    const otherSize = await loadMapFiles(
      maps,
      GameMapType.Onion,
      GameMapSize.Normal,
    );
    await expect(
      createGameRunner(start, undefined, otherSize, () => {}),
    ).rejects.toThrow(/the files passed are/);
    const otherMap = await loadMapFiles(
      maps,
      GameMapType.Pangaea,
      GameMapSize.Compact,
    );
    await expect(
      createGameRunner(start, undefined, otherMap, () => {}),
    ).rejects.toThrow(/the files passed are/);
  });
});
