import Benchmark from "benchmark";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { BotExecution } from "../../src/core/execution/BotExecution";
import { PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { setup } from "../util/Setup";

const game = await setup(
  "big_plains",
  {
    infiniteGold: true,
    instantBuild: true,
  },
  [
    new PlayerInfo("p1", PlayerType.Human, "c1", "p1"),
    new PlayerInfo("bot1", PlayerType.Bot, null, "bot1"),
  ],
  dirname(fileURLToPath(import.meta.url)),
);

const botPlayer = game.player("bot1");
const botExec = new BotExecution(botPlayer);
botExec.init(game);
(botExec as any).attackRate = 1;
(botExec as any).attackTick = 0;

// Prepare the bot state (spawn it)
botPlayer.setSpawnTile(game.ref(50, 50));
// Give it some territory so it has something to think about
for(let i=0; i<100; i++) {
    game.map().setOwnerID(game.ref(50+i, 50), botPlayer.smallID());
}

const results: string[] = [];
let tick = 0;

new Benchmark.Suite()
  .add("BotExecution.tick()", () => {
    botExec.tick(tick++);
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Bot Logic Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
