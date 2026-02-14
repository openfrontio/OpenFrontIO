import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

// Setup dense territory scenario (large target area)
// We use a dense territory to ensure that checks like port spawning, etc. have many candidates if applicable.
// buildableUnits(null) checks global availability which might verify conditions across the map.

const game = await setup(
  "big_plains",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
  dirname(fileURLToPath(import.meta.url)),
);

while (game.inSpawnPhase()) {
  game.executeNextTick();
}

const player = game.player("player_id");

// Conquer a significant portion of the map to have valid spawn locations for things like ports (if near water)
// and to ensure we have "validStructureSpawnTiles" cached or calculated.
for (let x = 0; x < 50; x++) {
  for (let y = 0; y < 50; y++) {
    const tile = game.ref(x, y);
    if (game.map().isLand(tile)) {
      player.conquer(tile);
    }
  }
}

let specificLandTile = game.ref(25, 25);
let specificWaterTile = game.ref(0, 0);

// Search for a water tile if 0,0 is not water
if (!game.map().isWater(specificWaterTile)) {
  for (let x = 0; x < game.map().width(); x++) {
    for (let y = 0; y < game.map().height(); y++) {
      const t = game.ref(x, y);
      if (game.map().isWater(t)) {
        specificWaterTile = t;
        break;
      }
    }
    if (game.map().isWater(specificWaterTile)) break;
  }
}

// Ensure land tile is actually land
if (!game.map().isLand(specificLandTile)) {
  for (let x = 0; x < game.map().width(); x++) {
    for (let y = 0; y < game.map().height(); y++) {
      const t = game.ref(x, y);
      if (game.map().isLand(t)) {
        specificLandTile = t;
        break;
      }
    }
    if (game.map().isLand(specificLandTile)) break;
  }
}

console.log("Benchmarks ready.");
console.log("Land tile:", specificLandTile.toString());
console.log("Water tile:", specificWaterTile.toString());

// Warmup
player.buildableUnits(null);
player.buildableUnits(specificLandTile);

const results: string[] = [];

new Benchmark.Suite()
  .add("buildableUnits(null)", () => {
    player.buildableUnits(null);
  })
  .add("buildableUnits(landTile)", () => {
    player.buildableUnits(specificLandTile);
  })
  .add("buildableUnits(waterTile)", () => {
    player.buildableUnits(specificWaterTile);
  })
  /*
    Future: If buildableUnits accepts a filter argument (e.g. ignore TransportShip), add cases here for performance comparison:
    
    // Test case: Check only TransportShip (e.g. for right-click on water)
    .add("buildableUnits(landTile, ONLY_TRANSPORT)", () => {
        // @ts-ignore
        player.buildableUnits(specificLandTile, { only: UnitType.TransportShip });
    })

    // Test case: Check everything EXCEPT TransportShip (e.g. build menu on land)
    .add("buildableUnits(landTile, NO_TRANSPORT)", () => {
        // @ts-ignore
        player.buildableUnits(specificLandTile, { exclude: UnitType.TransportShip });
    })
  */
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== buildableUnits Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
