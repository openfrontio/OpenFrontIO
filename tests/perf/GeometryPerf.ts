import Benchmark from "benchmark";
import { simpleHash, within, manhattanDistWrapped } from "../../src/core/Util";
import { Cell } from "../../src/core/game/Game";

const c1 = new Cell(10, 10);
const c2 = new Cell(90, 90);
const width = 100;

const results: string[] = [];

new Benchmark.Suite()
  .add("manhattanDistWrapped", () => {
    manhattanDistWrapped(c1, c2, width);
  })
  .add("simpleHash", () => {
    simpleHash("some-long-string-identifier-for-testing-hash-performance");
  })
  .add("within", () => {
    within(50, 0, 100);
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Geometry/Math Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
