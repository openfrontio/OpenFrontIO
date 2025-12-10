import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Player, PlayerInfo } from "../src/core/game/Game";
import { setup } from "./util/Setup";

describe("Territory management", () => {
  test("player owns the tile it spawns on", async () => {
    const game = await setup("plains");
    game.addPlayer(new PlayerInfo("test_player", "HUMAN", null, "test_id"));
    const spawnTile = game.map().ref(50, 50);
    game.addExecution(
      new SpawnExecution(game.player("test_id").info(), spawnTile),
    );
    // Init the execution
    game.executeNextTick();
    // Execute the execution.
    game.executeNextTick();

    const owner = game.owner(spawnTile);
    expect(owner.isPlayer()).toBe(true);
    expect((owner as Player).name()).toBe("test_player");
  });
});
