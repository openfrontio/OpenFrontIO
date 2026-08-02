import { Executor } from "../src/core/execution/ExecutionManager";
import { NoOpExecution } from "../src/core/execution/NoOpExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { ClientID, GameID, StampedIntent } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const gameID: GameID = "game_id";

describe("Spawn intent after the spawn phase", () => {
  it("is dropped instead of placing territory", async () => {
    const game = await setup("plains", { infiniteGold: true });
    const info = new PlayerInfo(
      "latecomer",
      PlayerType.Human,
      "late_client",
      "late_id",
    );
    game.addPlayer(info);
    const latecomer = game.player(info.id);
    expect(game.inSpawnPhase()).toBe(false);

    const intent = {
      type: "spawn",
      tile: game.ref(40, 40),
      clientID: "late_client",
    } as StampedIntent;
    const exec = new Executor(
      game,
      gameID,
      "late_client" as ClientID,
    ).createExec(intent);

    expect(exec).toBeInstanceOf(NoOpExecution);
    expect(exec).not.toBeInstanceOf(SpawnExecution);

    game.addExecution(exec);
    game.executeNextTick();
    game.executeNextTick();
    expect(latecomer.hasSpawned()).toBe(false);
    expect(latecomer.numTilesOwned()).toBe(0);
  });
});
