import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import { executeTicks } from "../../util/utils";
import { setup } from "../../util/Setup";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("PlayerExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    otherPlayer = game.player("other_id");

    game.addExecution(new PlayerExecution(player));
    game.addExecution(new PlayerExecution(otherPlayer));
  });
  test("DefensePost is destroyed, not captured, when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const defensePost = player.buildUnit(UnitType.DefensePost, tile, {});

    expect(defensePost.isActive()).toBe(true);
    expect(defensePost.owner()).toBe(player);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(defensePost.isActive()).toBe(false);
    expect(player.units(UnitType.DefensePost)).toHaveLength(0); // Neither player owns the now inactive DefensePost
    expect(otherPlayer.units(UnitType.DefensePost)).toHaveLength(0);
  });

  test("City is captured (transferred), not destroyed, when tile owner changes", () => {
    const tile = game.ref(50, 50);
    player.conquer(tile);
    const city = player.buildUnit(UnitType.City, tile, {});

    expect(city.owner()).toBe(player);

    otherPlayer.conquer(tile);
    executeTicks(game, 2);

    expect(city.isActive()).toBe(true);
    expect(city.owner()).toBe(otherPlayer);
    expect(player.units(UnitType.City)).toHaveLength(0);
    expect(otherPlayer.units(UnitType.City)).toHaveLength(1); // City transferred
  });
});
