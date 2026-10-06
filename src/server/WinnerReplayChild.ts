// The winner-replay subprocess (see WinnerReplay.ts): receives one game's
// start info and turns, replays them, sends back the result and exits.
import {
  GameMapLoader,
  MapData,
  MapManifest,
} from "@openfront/engine-api/game/GameMapLoader";
import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { replayWinner } from "@openfront/engine/WinnerReplay";
import fs from "fs";
import { readMapFile } from "./MapFiles";
import type { ReplayRequest, ReplayResponse } from "./WinnerReplay";

class ServerGameMapLoader implements GameMapLoader {
  getMapData(map: GameMapType): MapData {
    const bin = (name: string) => async () =>
      new Uint8Array(await readMapFile(map, name));
    return {
      mapBin: bin("map.bin"),
      map4xBin: bin("map4x.bin"),
      map16xBin: bin("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          (await readMapFile(map, "manifest.json")).toString("utf8"),
        ) as MapManifest,
      webpPath: "",
      layerPng: async () => {
        throw new Error("the server never renders map layers");
      },
    };
  }
}

// The simulation logs as it goes (wins, cancelled matches, per-tick debug);
// none of it belongs in the server's logs. Warnings and errors still go out.
console.log = console.info = console.debug = () => {};

// First in line for the OOM killer. Nice only yields CPU; under memory
// pressure the kernel would otherwise pick by size, and could take a game
// worker (and every live game on it) over this. A killed replay falls back
// to the vote's result. Raising our own score needs no privileges; /proc is
// Linux-only, so elsewhere (local dev on a Mac) this is skipped.
try {
  fs.writeFileSync("/proc/self/oom_score_adj", "1000");
} catch {
  // not Linux
}

process.once("message", (req: ReplayRequest) => {
  replayWinner(req.gameStart, req.turns, new ServerGameMapLoader())
    .then(
      (result): ReplayResponse => ({ ok: true, result }),
      (error: unknown): ReplayResponse => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .then((res) => process.send!(res, () => process.exit(0)));
});
