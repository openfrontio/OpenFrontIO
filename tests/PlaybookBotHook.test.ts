import { beforeEach, describe, expect, test } from "vitest";
import { Executor } from "../src/core/execution/ExecutionManager";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameRunner } from "../src/core/GameRunner";
import { setup } from "./util/Setup";

const gameID = "bot_hook";

describe("GameRunner playbook bot hook", () => {
  let game: Game;
  let runner: (botClient: string | undefined) => () => void;

  beforeEach(async () => {
    game = await setup("plains", {}, [], undefined, undefined, false);
    const alice = new PlayerInfo(
      "alice",
      PlayerType.Human,
      "alice_client",
      "alice_id",
    );
    game.addPlayer(alice);
    game.addExecution(new SpawnExecution(gameID, alice, game.ref(10, 10)));
    runner = (botClient) => {
      const gr = new GameRunner(
        game,
        new Executor(game, gameID, "alice_client"),
        () => {},
        botClient,
      );
      let turn = 0;
      return () => {
        gr.addTurn({ turnNumber: turn++, intents: [] });
        gr.executeNextTick();
      };
    };
  });

  test("bot takes over the local player after the spawn phase", () => {
    const tick = runner("alice_client");
    tick();
    tick();
    const before = game.player("alice_id").numTilesOwned();
    // still in spawn phase — bot must not have started expanding
    for (let i = 0; i < 20; i++) tick();
    expect(game.player("alice_id").numTilesOwned()).toBe(before);

    game.endSpawnPhase();
    for (let i = 0; i < 100; i++) tick();
    expect(game.player("alice_id").numTilesOwned()).toBeGreaterThan(before);
  });

  test("without the flag the player stays idle", () => {
    const tick = runner(undefined);
    tick();
    tick();
    game.endSpawnPhase();
    const before = game.player("alice_id").numTilesOwned();
    for (let i = 0; i < 100; i++) tick();
    expect(game.player("alice_id").numTilesOwned()).toBe(before);
  });
});
