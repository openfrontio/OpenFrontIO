import Benchmark from "benchmark";
import { GameMapImpl } from "../../src/core/game/GameMap";

const suite = new Benchmark.Suite();

const width = 1000;
const height = 1000;
const terrain = new Uint8Array(width * height);
// Fill with random terrain
for (let i = 0; i < terrain.length; i++) {
  terrain[i] = (Math.random() * 255) | 0;
}

const gm = new GameMapImpl(width, height, terrain, 0);
const tiles: number[] = [];
for (let i = 0; i < 10000; i++) {
  tiles.push(Math.floor(Math.random() * (width * height)));
}

suite.add("GameMap.neighbors (array allocation)", () => {
  for (const t of tiles) {
    const n = gm.neighbors(t);
    void n.length;
  }
});

suite.add("GameMap.forEachNeighbor (callback)", () => {
  for (const t of tiles) {
    gm.forEachNeighbor(t, (n) => {
      void n;
    });
  }
});

suite
  .on("cycle", (event: any) => {
    console.log(String(event.target));
  })
  .on("complete", () => {
    console.log("Benchmark complete");
  })
  .run({ async: true });
