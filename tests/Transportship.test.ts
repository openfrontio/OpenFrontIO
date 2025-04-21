import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { setup } from "./util/Setup";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { GameImpl } from "../src/core/game/GameImpl";

let game: Game;
let attackerPlayer: Player;
let targetPlayer: Player;

describe("Transport Ship", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", {
      infiniteGold: true,
      instantBuild: true,
    });

    // Create Player 1 (attacker)
    const attackerPlayerInfo = new PlayerInfo(
      "us",
      "attacker_player",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerPlayerInfo, 1000);

    // Create Player 2 (target player)
    const targetPlayerInfo = new PlayerInfo(
      "us",
      "target_player",
      PlayerType.Human,
      null,
      "target_id",
    );
    game.addPlayer(targetPlayerInfo, 1000);

    // spawn the attacker on a shore
    const attackerSpawnTile = game.map().ref(7, 0);
    game.addExecution(
      new SpawnExecution(
        game.player(attackerPlayerInfo.id).info(),
        attackerSpawnTile,
      ),
    );

    // Spawn the target player on a shore
    const targetSpawnTile = game.map().ref(7, 15);
    game.addExecution(
      new SpawnExecution(
        game.player(targetPlayerInfo.id).info(),
        targetSpawnTile,
      ),
    );

    // Execute spawn phase
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attackerPlayer = game.player("attacker_id");
    targetPlayer = game.player("target_id");
  });

  test("Transport ship attacks if target tile is owned", async () => {
    // Attacker sends an Transportship on the ocean near the target player
    const transportExecution = new TransportShipExecution(
      attackerPlayer.id(),
      null,
      game.map().ref(8, 15),
      10,
    );
    game.addExecution(transportExecution);

    game.executeNextTick();

    // Ensure the ship is spawned and ready
    expect(attackerPlayer.units(UnitType.TransportShip)).toHaveLength(1);

    // Move the transport ship until it reaches the shore
    for (let i = 0; i < 18; i++) {
      game.executeNextTick();
    }

    // Ensure the attack was triggered and is attacking the target player
    const attackExecutions = (game as GameImpl)
      .executions()
      .filter((exec) => exec instanceof AttackExecution);

    expect(attackExecutions.length).toBeGreaterThan(0);
    expect(attackExecutions[0].targetID()).toBe(targetPlayer.id());
  });
});
