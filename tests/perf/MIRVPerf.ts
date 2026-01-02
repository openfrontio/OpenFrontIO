import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { MirvExecution } from "../../src/core/execution/MIRVExecution";
import { PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

// Setup sparse territory scenario (small target area)
const sparseTerritoryGame = await setup(
  "big_plains",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
  dirname(fileURLToPath(import.meta.url)),
);

while (sparseTerritoryGame.inSpawnPhase()) {
  sparseTerritoryGame.executeNextTick();
}

const sparsePlayer = sparseTerritoryGame.player("player_id");

function claimRow(y: number, length: number) {
  for (let x = 0; x < 200; x++) {
    for (let dy = y; dy < y + length; dy++) {
      const tile = sparseTerritoryGame.ref(x, dy);
      if (sparseTerritoryGame.map().isLand(tile)) {
        sparsePlayer.conquer(tile);
      }
    }
  }
}

claimRow(0, 15);
claimRow(40, 15);
claimRow(90, 15);
claimRow(140, 15);
claimRow(185, 15);

sparsePlayer.buildUnit(
  UnitType.MissileSilo,
  sparseTerritoryGame.ref(10, 10),
  {},
);

// Setup dense territory scenario (large target area)
const denseTerritoryGame = await setup(
  "big_plains",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
  dirname(fileURLToPath(import.meta.url)),
);

while (denseTerritoryGame.inSpawnPhase()) {
  denseTerritoryGame.executeNextTick();
}

const densePlayer = denseTerritoryGame.player("player_id");

for (let x = 0; x < 200; x++) {
  for (let y = 0; y < 200; y++) {
    const tile = denseTerritoryGame.ref(x, y);
    if (denseTerritoryGame.map().isLand(tile)) {
      densePlayer.conquer(tile);
    }
  }
}

densePlayer.buildUnit(UnitType.MissileSilo, denseTerritoryGame.ref(10, 10), {});

// Setup giant world map scenario (realistic large-scale test)
const giantMapGame = await setup(
  "giantworldmap",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
  dirname(fileURLToPath(import.meta.url)),
);

while (giantMapGame.inSpawnPhase()) {
  giantMapGame.executeNextTick();
}

const giantMapPlayer = giantMapGame.player("player_id");

// Conquer ALL available land tiles on the giant world map
console.log("Conquering all tiles on giant world map...");
let conqueredCount = 0;
for (let x = 0; x < giantMapGame.map().width(); x++) {
  for (let y = 0; y < giantMapGame.map().height(); y++) {
    const tile = giantMapGame.ref(x, y);
    if (giantMapGame.map().isLand(tile)) {
      giantMapPlayer.conquer(tile);
      conqueredCount++;
    }
  }
}
console.log(`Conquered ${conqueredCount} tiles on giant world map`);

giantMapPlayer.buildUnit(UnitType.MissileSilo, giantMapGame.ref(800, 350), {});

const results: string[] = [];

new Benchmark.Suite()
  .add("MIRV target selection - sparse territory", () => {
    const targetTile = sparseTerritoryGame.ref(100, 100);
    const mirvExec = new MirvExecution(sparsePlayer, targetTile);

    mirvExec.init(sparseTerritoryGame, sparseTerritoryGame.ticks());

    let ticks = 0;
    while (mirvExec.isActive() && ticks < 1000) {
      mirvExec.tick(ticks++);
    }
  })
  .add("MIRV target selection - dense territory", () => {
    const targetTile = denseTerritoryGame.ref(100, 100);
    const mirvExec = new MirvExecution(densePlayer, targetTile);

    mirvExec.init(denseTerritoryGame, denseTerritoryGame.ticks());

    let ticks = 0;
    while (mirvExec.isActive() && ticks < 1000) {
      mirvExec.tick(ticks++);
    }
  })
  .add("MIRV target selection - giant world map (350 targets)", () => {
    const targetTile = giantMapGame.ref(2150, 800);
    const mirvExec = new MirvExecution(giantMapPlayer, targetTile);

    mirvExec.init(giantMapGame, giantMapGame.ticks());

    let ticks = 0;
    while (mirvExec.isActive() && ticks < 1000) {
      mirvExec.tick(ticks++);
    }
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== MIRV Performance Benchmark Results ===");

    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
