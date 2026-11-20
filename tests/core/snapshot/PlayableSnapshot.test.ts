/**
 * A scenario nation's `playable` flag is player state: snapshots keep it,
 * and players from snapshots written before it existed read as unplayable.
 */

import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";
import {
  restoreScriptedRunner,
  scriptedGameStart,
} from "../../util/ScriptedGame";
import { setup } from "../../util/Setup";
import { diffGraphs, diffSnapshots, roundTrip } from "../../util/Snapshot";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("playable survives a snapshot round trip", async () => {
  const game = await setup("plains");
  const playable = game.addPlayer(
    new PlayerInfo("France", PlayerType.Nation, null, "FRANCE01"),
  );
  game.addPlayer(new PlayerInfo("Spain", PlayerType.Nation, null, "SPAIN001"));
  playable.setPlayable(true);
  const { bytes, restored, again } = await roundTrip(game, "plains");
  expect(restored.player("FRANCE01").playable()).toBe(true);
  expect(restored.player("SPAIN001").playable()).toBe(false);
  expect(diffGraphs(game, restored)).toEqual([]);
  expect(diffSnapshots(bytes, again)).toEqual([]);
});

test("players from a format-1 snapshot are not playable", async () => {
  const bytes = new Uint8Array(
    gunzipSync(
      fs.readFileSync(
        path.join(__dirname, "../../testdata/snapshots/format-1.snapshot.gz"),
      ),
    ),
  );
  const runner = await restoreScriptedRunner(
    "world",
    scriptedGameStart(),
    bytes,
  );
  const players = runner.game.allPlayers();
  expect(players.some((p) => p.type() === PlayerType.Nation)).toBe(true);
  for (const p of players) expect(p.playable()).toBe(false);
}, 60_000);
