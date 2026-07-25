/**
 * Tribes (roaming Bot players) are not spawned in this fork — the map is
 * pre-filled by country nations instead. Even with `bots` set in the config
 * (kept for replay compatibility), GameRunner.init() must not create any
 * PlayerType.Bot players.
 */
import { Executor } from "../src/core/execution/ExecutionManager";
import { PlayerType } from "../src/core/game/Game";
import { GameRunner } from "../src/core/GameRunner";
import { setup } from "./util/Setup";

describe("No tribes", () => {
  test("bots config is ignored: no Bot players after init and spawn ticks", async () => {
    const game = await setup(
      "plains",
      { bots: 400 },
      [],
      undefined,
      undefined,
      false,
    );
    expect(game.config().bots()).toBe(400);

    const runner = new GameRunner(
      game,
      new Executor(game, "no_tribes_test", undefined),
      () => {},
    );
    runner.init();

    for (let turn = 0; turn < 10; turn++) {
      runner.addTurn({ turnNumber: turn, intents: [] });
      runner.executeNextTick();
    }

    const bots = game.allPlayers().filter((p) => p.type() === PlayerType.Bot);
    expect(bots).toHaveLength(0);
  });
});
