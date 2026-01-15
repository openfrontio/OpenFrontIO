import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { setup } from "../util/Setup";

const game = await setup(
  "giantworldmap",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [],
  dirname(fileURLToPath(import.meta.url)),
);

const map = game.map();
const width = map.width();
const height = map.height();
const size = width * height;

const results: string[] = [];

// Access patterns
new Benchmark.Suite()
  .add("GameMap.isLand() Iteration", () => {
    let count = 0;
    for (let i = 0; i < size; i++) {
      if (map.isLand(i)) count++;
    }
  })
  .add("GameMap.ref() + Properties Random Access", () => {
    // Random access simulation (1000 lookups)
    for (let i = 0; i < 1000; i++) {
      const x = (Math.random() * width) | 0;
      const y = (Math.random() * height) | 0;
      const ref = map.ref(x, y);
      const owner = map.ownerID(ref);
      const isLand = map.isLand(ref);
    }
  })
  .add("GameMap.neighbors()", () => {
     // Test neighbor lookup cost
     for (let i = 0; i < 1000; i++) {
        const ref = (Math.random() * size) | 0;
        map.neighbors(ref);
     }
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Map Access Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
