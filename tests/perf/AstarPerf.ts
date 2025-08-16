import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { PathFinder } from "../../src/core/pathfinding/PathFinding";
import { setup } from "../util/Setup";

const game = await setup(
  "giantworldmap",
  {},
  [],
  dirname(fileURLToPath(import.meta.url)),
);

new Benchmark.Suite()
  .add("top-left-to-bottom-right", () => {
    PathFinder.Mini(game, 10_000_000_000, true, 1).nextTile(
      game.ref(0, 0),
      game.ref(4077, 1929),
    );
  })
  .add("hawaii to svalbard", () => {
    PathFinder.Mini(game, 10_000_000_000, true, 1).nextTile(
      game.ref(186, 800),
      game.ref(2205, 52),
    );
  })
  .add("black sea to california", () => {
    PathFinder.Mini(game, 10_000_000_000, true, 1).nextTile(
      game.ref(2349, 455),
      game.ref(511, 536),
    );
  })
  .on("cycle", (event: any) => {
    console.log(String(event.target));
  })
  .run({ async: true });
