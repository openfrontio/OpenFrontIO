import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { AStarRail } from "../../src/core/pathfinding/algorithms/AStar.Rail";
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
// Find land points for rail pathfinding
let start = -1;
let end = -1;

// Scan for start (land)
for (let i = 0; i < map.width() * map.height(); i++) {
  if (map.isLand(i)) {
    start = i;
    break;
  }
}

// Scan for end (land, far away)
for (let i = map.width() * map.height() - 1; i >= 0; i--) {
  if (map.isLand(i)) {
    end = i;
    break;
  }
}

console.log(
  `Rail Pathfinding from ${start} to ${end} on giant map (${map.width()}x${map.height()})`,
);

const astar = new AStarRail(map);
const results: string[] = [];

new Benchmark.Suite()
  .add("A* Rail Pathfinding - Giant Map", () => {
    astar.findPath(start, end);
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Rail Pathfinding Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
