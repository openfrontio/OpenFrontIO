import { MirvExecution } from "../../../src/core/execution/MIRVExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";

import { setup } from "../../util/Setup";
import { constructionExecution } from "../../util/utils";

let game: Game;
let player: Player;

describe("MirvExecution", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
    const playerInfo = new PlayerInfo(
      "player_id",
      PlayerType.Human,
      null,
      "player_id",
    );
    game.addPlayer(playerInfo);

    game.addExecution(
      new SpawnExecution(game.player(playerInfo.id).info(), game.ref(1, 1)),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");

    constructionExecution(game, player, 1, 1, UnitType.MissileSilo);
  });

  test("MIRV should have a fixed travel time regardless of target distance", async () => {
    const nearTarget = game.ref(5, 5);
    const farTarget = game.ref(50, 50);

    const mirvNear = new MirvExecution(player, nearTarget);
    game.addExecution(mirvNear);
    const mirvFar = new MirvExecution(player, farTarget);
    game.addExecution(mirvFar);

    // Execute ticks until both MIRVs have landed
    let ticksNear = 0;
    let ticksFar = 0;

    while (mirvNear.isActive() || mirvFar.isActive()) {
      game.executeNextTick();
      if (mirvNear.isActive()) {
        ticksNear++;
      }
      if (mirvFar.isActive()) {
        ticksFar++;
      }
    }

    // The travel times should be approximately the same
    // Allowing for a small margin of error due to pathfinding or tick execution nuances
    const tolerance = 2; // Ticks
    expect(Math.abs(ticksNear - ticksFar)).toBeLessThanOrEqual(tolerance);
  });
});
