import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { PlayerInfo, PlayerType, UnitType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

const game = await setup(
  "giantworldmap",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [
    new PlayerInfo("p1", PlayerType.Human, "c1", "p1"),
    new PlayerInfo("p2", PlayerType.Bot, "c2", "p2"),
  ],
  dirname(fileURLToPath(import.meta.url)),
);

const p1 = game.player("p1");
const p2 = game.player("p2");

// Spawn a significant number of units to stress the loop
// Place them somewhat randomly but validly
const width = game.map().width();
const height = game.map().height();

console.log("Spawning 1000 units for Game Tick benchmark...");
let unitsSpawned = 0;
for (let i = 0; i < 50000 && unitsSpawned < 1000; i++) {
  const x = Math.floor(Math.random() * width);
  const y = Math.floor(Math.random() * height);
  const tile = game.ref(x, y);

  if (game.map().isLand(tile)) {
    // Owner needs to own the tile to build? Usually yes.
    p1.conquer(tile);
    // Build different types
    const type = UnitType.DefensePost;
    // Just force spawn via internal method if possible or use build
    // buildUnit checks validity.
    p1.buildUnit(type, tile, {});
    unitsSpawned++;
  }
}

console.log(`Spawned ${unitsSpawned} units.`);

const results: string[] = [];

new Benchmark.Suite()
  .add("Game Tick Execution (1000 units)", () => {
    game.executeNextTick();
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Game Tick Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
