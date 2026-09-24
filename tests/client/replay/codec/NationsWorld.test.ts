/**
 * Long real-world fixture: impossible nations on the world map for ~7 game
 * minutes - long enough for ports, trade ships, factories and trains (rail
 * motion plans). Players and units are checked against the live game every
 * tick; full-map tiles are sampled (the map is 2M tiles).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../../../src/core/configuration/Config";
import { NationExecution } from "../../../../src/core/execution/NationExecution";
import { RecomputeRailClusterExecution } from "../../../../src/core/execution/RecomputeRailClusterExecution";
import {
  Cell,
  Difficulty,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../../src/core/game/Game";
import { setup } from "../../../util/Setup";
import { expectReplayMatches } from "../util/Expect";
import { openReader, recordGame } from "../util/RecordGame";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadWorldNations(): Nation[] {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../../testdata/maps/world/manifest.json"),
      "utf8",
    ),
  ) as { nations: { coordinates: [number, number]; name: string }[] };
  return manifest.nations.map(
    (n) =>
      new Nation(
        new Cell(n.coordinates[0], n.coordinates[1]),
        new PlayerInfo(n.name, PlayerType.Nation, null, n.name),
      ),
  );
}

test("world map nations: trade ships and trains round-trip", async () => {
  const nations = loadWorldNations();
  const game = await setup(
    "world",
    { difficulty: Difficulty.Impossible },
    [],
    undefined,
    Config,
    false,
    nations,
  );
  for (const nation of nations) {
    game.addExecution(new NationExecution("game_id", nation));
  }
  game.addExecution(new RecomputeRailClusterExecution(game.railNetwork()));

  let spawnEnded = false;
  const rec = await recordGame(game, {
    ticks: 4100,
    keyframeInterval: 100,
    skipInit: true,
    tileTruthEvery: 97,
    beforeTick: (g) => {
      if (!spawnEnded && g.allPlayers().every((p) => p.hasSpawned())) {
        g.endSpawnPhase();
        spawnEnded = true;
      }
    },
  });

  const reader = openReader(rec.replay);
  const h = reader.header;
  // The fixture must actually exercise what it claims to.
  const types = new Set(
    rec.truth.flatMap((t) => [...t.units.values()].map((u) => u.unitType)),
  );
  expect(types).toContain(UnitType.TradeShip);
  expect(types).toContain(UnitType.Train);
  expect(h.railroadEvents.length).toBeGreaterThan(0);

  expectReplayMatches(rec);
}, 600_000);
