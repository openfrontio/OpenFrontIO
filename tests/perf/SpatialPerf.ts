import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { UnitGrid } from "../../src/core/game/UnitGrid";
import { setup } from "../util/Setup";

// Use a dense map for spatial testing
const game = await setup(
  "big_plains",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [new PlayerInfo("p1", PlayerType.Human, "c1", "p1")],
  dirname(fileURLToPath(import.meta.url)),
);

const p1 = game.player("p1");
const map = game.map();
const unitGrid = (game as any).unitGrid as UnitGrid; // Access private property if needed or expose it

// Fill a 100x100 area with units
console.log("Populating 100x100 area with units...");
for (let x = 50; x < 150; x += 2) {
  for (let y = 50; y < 150; y += 2) {
    const tile = game.ref(x, y);
    p1.conquer(tile);
    p1.buildUnit(UnitType.DefensePost, tile, {});
  }
}

// Test queries
const centerTile = game.ref(100, 100);
const results: string[] = [];

new Benchmark.Suite()
  .add("UnitGrid.nearbyUnits (Small Range r=5)", () => {
    unitGrid.nearbyUnits(centerTile, 5, UnitType.DefensePost);
  })
  .add("UnitGrid.nearbyUnits (Medium Range r=20)", () => {
    unitGrid.nearbyUnits(centerTile, 20, UnitType.DefensePost);
  })
  .add("UnitGrid.nearbyUnits (Large Range r=50)", () => {
    unitGrid.nearbyUnits(centerTile, 50, UnitType.DefensePost);
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Spatial Query Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
