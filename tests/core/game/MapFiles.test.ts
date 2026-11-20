import {
  CustomGameMap,
  GameMapSize,
  GameMapType,
} from "@openfront/engine-api/game/GameTypes";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { createGameRunner } from "@openfront/engine/GameRunner";
import {
  loadMapFiles,
  mapFilesTransfer,
} from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "../../perf/fullgame/NodeGameMapLoader";
import {
  createScriptedRunner,
  restoreScriptedRunner,
  scriptedGameStart,
  stepScripted,
} from "../../util/ScriptedGame";

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

  test("a Custom game starts on any map's files", async () => {
    const start = scriptedGameStart({
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Compact,
    });
    for (const stock of [GameMapType.Onion, GameMapType.Pangaea]) {
      const files = await loadMapFiles(maps, stock, GameMapSize.Compact);
      const { width, height } = files.manifest.map4x;
      const runner = await createGameRunner(start, undefined, files, () => {});
      expect([runner.game.width(), runner.game.height()]).toEqual([
        width,
        height,
      ]);
    }
    // The size still has to match: it decides which bins the game reads.
    const otherSize = await loadMapFiles(
      maps,
      GameMapType.Onion,
      GameMapSize.Normal,
    );
    await expect(
      createGameRunner(start, undefined, otherSize, () => {}),
    ).rejects.toThrow(/the files passed are/);
  });

  test("a Custom snapshot restores only onto the files it was taken on", async () => {
    const start = scriptedGameStart({
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
      bots: 0,
    });
    const runner = await createScriptedRunner("ocean_and_land", start);
    for (let i = 0; i < 3; i++) stepScripted(runner);
    const snapshot = runner.snapshot();

    const restored = await restoreScriptedRunner(
      "ocean_and_land",
      start,
      snapshot,
    );
    expect(restored.game.ticks()).toBe(runner.game.ticks());

    // Same size, different terrain: only the snapshot's map hash tells them
    // apart.
    await expect(
      restoreScriptedRunner("half_land_half_ocean", start, snapshot),
    ).rejects.toThrow(
      /map file differs from the one the snapshot was taken on/,
    );
  });
});
