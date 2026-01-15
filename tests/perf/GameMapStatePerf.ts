import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { setup } from "../util/Setup";

const game = await setup(
  "big_plains",
  {
    infiniteGold: true,
  },
  [],
  dirname(fileURLToPath(import.meta.url)),
);

const map = game.map();
const ref = map.ref(50, 50);

const results: string[] = [];

new Benchmark.Suite()
  .add("GameMap.setOwnerID", () => {
    map.setOwnerID(ref, 1);
  })
  .add("GameMap.setFallout", () => {
    map.setFallout(ref, true);
    map.setFallout(ref, false);
  })
  .add("GameMap.updateTile (Roundtrip)", () => {
    const update = map.toTileUpdate(ref);
    map.updateTile(update);
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== GameMap State Update Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
