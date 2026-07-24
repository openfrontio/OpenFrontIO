import { Executor } from "../../../src/core/execution/ExecutionManager";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { StampedIntent } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

describe("Executor.createExec", () => {
  test("marks a client spawn intent with fromIntent so it is gated by the spawn phase", async () => {
    const playerInfo = new PlayerInfo(
      "player",
      PlayerType.Human,
      "client_id",
      "player_id",
    );
    // setup() ends the spawn phase by default, so the game is already underway.
    const game = await setup("half_land_half_ocean", {}, [playerInfo]);

    const executor = new Executor(game, "game_id", "client_id");
    const exec = executor.createExec({
      type: "spawn",
      tile: 20,
      clientID: "client_id",
    } as StampedIntent);

    expect(exec).toBeInstanceOf(SpawnExecution);
    expect((exec as SpawnExecution).tile).toBe(20);

    // Because it originated from a client intent (fromIntent = true), executing
    // it after the spawn phase must be a no-op — the player never spawns.
    game.addExecution(exec);
    game.executeNextTick();
    game.executeNextTick();
    expect(game.playerByClientID("client_id")?.hasSpawned() ?? false).toBe(
      false,
    );
  });
});
