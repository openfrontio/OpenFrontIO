import {
  GameUpdateType,
  GameUpdateViewData,
  UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { createGameRunnerFromSnapshot } from "@openfront/engine/GameRunner";
import { readSnapshotHeader } from "@openfront/engine/snapshot/GameSnapshot";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";
import {
  scriptedGameStart,
  stepScripted,
  TestDataMapLoader,
} from "../../util/ScriptedGame";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A World game at tick 600: well past spawn, with territory and units.
const SNAPSHOT = new Uint8Array(
  gunzipSync(
    fs.readFileSync(
      path.join(__dirname, "../../testdata/snapshots/format-1.snapshot.gz"),
    ),
  ),
);

async function mapFiles() {
  const { gameMap, gameMapSize } = readSnapshotHeader(SNAPSHOT).gameConfig;
  return loadMapFiles(new TestDataMapLoader("world"), gameMap, gameMapSize);
}

/**
 * Restores the snapshot, runs one tick, and applies that tick's update to a
 * map freshly loaded from the map files: the page's view of a game it is
 * shown from a snapshot.
 */
async function firstTickView(resync: boolean) {
  const updates: GameUpdateViewData[] = [];
  const runner = await createGameRunnerFromSnapshot(
    scriptedGameStart(),
    SNAPSHOT,
    undefined,
    await mapFiles(),
    (gu) => {
      if (!("errMsg" in gu)) updates.push(gu);
    },
  );
  if (resync) runner.game.queueViewResync();
  stepScripted(runner);

  const view = (await loadTerrainMap(await mapFiles())).gameMap as GameMapImpl;
  const [gu] = updates;
  for (let i = 0; i + 1 < gu.packedTileUpdates.length; i += 2) {
    view.updateTile(gu.packedTileUpdates[i], gu.packedTileUpdates[i + 1]);
  }
  const game = runner.game.map() as GameMapImpl;
  let mismatchedTiles = 0;
  for (let tile = 0; tile < game.width() * game.height(); tile++) {
    if (
      view.tileState(tile) !== game.tileState(tile) ||
      view.terrainByte(tile) !== game.terrainByte(tile)
    ) {
      mismatchedTiles++;
    }
  }
  return { runner, gu, mismatchedTiles };
}

describe("resyncing a view of a restored game", { timeout: 60_000 }, () => {
  test("without it, a fresh view misses the restored territory", async () => {
    const { mismatchedTiles } = await firstTickView(false);
    expect(mismatchedTiles).toBeGreaterThan(0);
  });

  test("the first tick brings a fresh view up to the game", async () => {
    const { runner, gu, mismatchedTiles } = await firstTickView(true);

    expect(mismatchedTiles).toBe(0);

    const sentUnits = new Set(
      (gu.updates[GameUpdateType.Unit] as UnitUpdate[]).map((u) => u.id),
    );
    const units = runner.game.units();
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) expect(sentUnits.has(unit.id())).toBe(true);

    // Without it the view stays in the spawn phase and offers a spawn.
    expect(runner.game.inSpawnPhase()).toBe(false);
    expect(gu.updates[GameUpdateType.SpawnPhaseEnd]).toHaveLength(1);
  });
});
