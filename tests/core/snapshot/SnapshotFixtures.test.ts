import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  compressSnapshot,
  decompressSnapshot,
  readSnapshotHeader,
  SNAPSHOT_FORMAT_VERSION,
} from "../../../src/core/snapshot/GameSnapshot";
import {
  createScriptedRunner,
  restoreScriptedRunner,
  scriptedGameStart,
  stepScripted,
} from "../../util/ScriptedGame";

/**
 * Snapshots written by earlier builds, which every later build must keep
 * loading (through record migrations when layouts change). Never edit or
 * delete a fixture; add a new one when the format changes meaningfully:
 *
 *   UPDATE_SNAPSHOT_FIXTURES=1 npx vitest tests/core/snapshot/SnapshotFixtures.test.ts --run
 *
 * writes `format-<N>.snapshot.gz` for the current root format if missing.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../testdata/snapshots");
const MAP = "world";
const FIXTURE_TICK = 600;
const start = scriptedGameStart();

function fixtures(): string[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".snapshot.gz"))
    .sort();
}

describe("snapshot fixtures from earlier builds", { timeout: 120_000 }, () => {
  test.runIf(process.env.UPDATE_SNAPSHOT_FIXTURES)(
    "write the fixture for the current format",
    async () => {
      const file = path.join(
        DIR,
        `format-${SNAPSHOT_FORMAT_VERSION}.snapshot.gz`,
      );
      if (fs.existsSync(file)) return;
      const runner = await createScriptedRunner(MAP, start);
      while (runner.game.ticks() < FIXTURE_TICK) stepScripted(runner);
      fs.writeFileSync(file, await compressSnapshot(runner.snapshot()));
    },
  );

  test("there is at least one fixture", () => {
    expect(fixtures().length).toBeGreaterThan(0);
  });

  test.each(fixtures())("%s restores and keeps playing", async (name) => {
    const bytes = await decompressSnapshot(
      new Uint8Array(fs.readFileSync(path.join(DIR, name))),
    );
    const header = readSnapshotHeader(bytes);
    const runner = await restoreScriptedRunner(MAP, start, bytes);
    expect(runner.game.ticks()).toBe(header.tick);
    expect(runner.game.players().length).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) stepScripted(runner);
    // A snapshot written by this build from the migrated game loads too.
    const again = await restoreScriptedRunner(MAP, start, runner.snapshot());
    expect(again.game.ticks()).toBe(header.tick + 100);
  });
});
