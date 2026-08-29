import { beforeEach, describe, expect, test } from "vitest";
import { Executor } from "../src/core/execution/ExecutionManager";
import { PlaybookBotExecution } from "../src/core/execution/playbook/PlaybookBotExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameRunner } from "../src/core/GameRunner";
import { setup } from "./util/Setup";

const gameID = "bot_hook";

describe("GameRunner playbook bot hook", () => {
  let game: Game;
  let alice: PlayerInfo;
  let runner: (botClient: string | undefined) => () => void;

  beforeEach(async () => {
    game = await setup("world", {}, [], undefined, undefined, false);
    alice = new PlayerInfo(
      "alice",
      PlayerType.Human,
      "alice_client",
      "alice_id",
    );
    game.addPlayer(alice);
    runner = (botClient) => {
      const gr = new GameRunner(
        game,
        new Executor(game, gameID, "alice_client"),
        () => {},
        botClient,
        gameID,
      );
      let turn = 0;
      return () => {
        gr.addTurn({ turnNumber: turn++, intents: [] });
        gr.executeNextTick();
      };
    };
  });

  test("bot picks its own spawn, then takes over after the spawn phase", () => {
    const tick = runner("alice_client");
    // phase 0: the bot spawns itself without any click
    for (let i = 0; i < 6; i++) tick();
    const me = game.player("alice_id");
    expect(me.hasSpawned()).toBe(true);
    const spawned = me.numTilesOwned();
    expect(spawned).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) tick();
    const settled = me.numTilesOwned();

    game.endSpawnPhase();
    for (let i = 0; i < 100; i++) tick();
    expect(me.numTilesOwned()).toBeGreaterThan(settled);
  });

  test("without the flag the player neither spawns nor acts", () => {
    const tick = runner(undefined);
    for (let i = 0; i < 6; i++) tick();
    expect(game.player("alice_id").hasSpawned()).toBe(false);

    const land = PlaybookBotExecution.pickSpawn(game)!;
    game.addExecution(new SpawnExecution(gameID, alice, land));
    tick();
    tick();
    expect(game.player("alice_id").hasSpawned()).toBe(true);
    game.endSpawnPhase();
    const before = game.player("alice_id").numTilesOwned();
    for (let i = 0; i < 100; i++) tick();
    expect(game.player("alice_id").numTilesOwned()).toBe(before);
  });
});
