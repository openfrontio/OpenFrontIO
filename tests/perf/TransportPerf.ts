import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import {
  candidateShoreTiles,
  closestShoreFromPlayer,
} from "../../src/core/game/TransportShipUtils";
import { setup } from "../util/Setup";

const game = await setup(
  "giantworldmap",
  { infiniteGold: true, instantBuild: true },
  [],
  dirname(fileURLToPath(import.meta.url)),
);

const map = game.map();

// Scenario 1: Regional Empire (~1,600 border tiles)
const regionalPlayer = game.addPlayer(
  new PlayerInfo("Regional Player", PlayerType.Human, null, "p1"),
);
const rx = 2000,
  ry = 1000,
  radius = 200;

// Validate map dimensions
if (map.width() < rx + radius || map.height() < ry + radius) {
  throw new Error(
    `Map too small for regional benchmark: needs at least ${rx + radius}x${ry + radius}, got ${map.width()}x${map.height()}`,
  );
}

let regionalShoreCount = 0;
for (let x = -radius; x <= radius; x++) {
  for (let y = -radius; y <= radius; y++) {
    if (Math.abs(x) === radius || Math.abs(y) === radius) {
      const t = game.ref(rx + x, ry + y);
      if (game.isValidRef(t) && game.isShore(t)) {
        regionalPlayer.conquer(t);
        regionalShoreCount++;
      }
    }
  }
}

// Validate that the benchmark area actually contains shore tiles
if (regionalShoreCount === 0) {
  throw new Error("Regional benchmark area contains no shore tiles.");
}

// Scenario 2: Global Empire (All shore tiles on earth)
const globalPlayer = game.addPlayer(
  new PlayerInfo("Global Player", PlayerType.Human, null, "p2"),
);
for (let i = 0; i < map.width(); i++) {
  for (let j = 0; j < map.height(); j++) {
    const tile = map.ref(i, j);
    if (map.isShore(tile)) {
      globalPlayer.conquer(tile);
    }
  }
}

const target = game.ref(400, 1200);
if (!game.isValidRef(target)) {
  throw new Error(
    `Target (400, 1200) is outside map bounds: ${map.width()}x${map.height()}`,
  );
}

new Benchmark.Suite()
  .add("closestShoreFromPlayer (Regional)", () => {
    closestShoreFromPlayer(map, regionalPlayer, target);
  })
  .add("candidateShoreTiles (Regional)", () => {
    candidateShoreTiles(game, regionalPlayer, target);
  })
  .add("closestShoreFromPlayer (Global Stress)", () => {
    closestShoreFromPlayer(map, globalPlayer, target);
  })
  .add("candidateShoreTiles (Global Stress)", () => {
    candidateShoreTiles(game, globalPlayer, target);
  })
  .on("cycle", (event: any) => {
    console.log(String(event.target));
  })
  .run({ async: true });
