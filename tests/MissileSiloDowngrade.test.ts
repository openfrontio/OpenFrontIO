import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { UpgradeStructureExecution } from "../src/core/execution/UpgradeStructureExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { constructionExecution, executeTicks } from "./util/utils";

const gameID: GameID = "game_id";

describe("Missile silo downgrade cooldown", () => {
  let game: Game;
  let player: Player;

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true });
    const info = new PlayerInfo("player", PlayerType.Human, null, "player_id");
    game.addPlayer(info);
    game.addExecution(
      new SpawnExecution(gameID, game.player(info.id).info(), game.ref(1, 1)),
    );
    player = game.player("player_id");
    constructionExecution(game, player, 1, 1, UnitType.MissileSilo);
  });

  test("downgrade with a ready slot keeps the active cooldown", () => {
    const silo = player.units(UnitType.MissileSilo)[0];
    // Upgrade puts the new slot on cooldown (queue length 1, level 2).
    game.addExecution(new UpgradeStructureExecution(player, silo.id()));
    executeTicks(game, 2);
    expect(silo.level()).toBe(2);
    expect(silo.missileTimerQueue()).toHaveLength(1);
    expect(silo.isInCooldown()).toBe(false);

    const cooldownBefore = silo.missileTimerQueue()[0];
    silo.decreaseLevel();
    expect(silo.level()).toBe(1);
    // Ready slot was lost; the active cooldown from the upgrade must remain.
    expect(silo.missileTimerQueue()).toEqual([cooldownBefore]);
    expect(silo.isInCooldown()).toBe(true);
  });

  test("downgrade when fully on cooldown drops one timer", () => {
    const silo = player.units(UnitType.MissileSilo)[0];
    game.addExecution(new UpgradeStructureExecution(player, silo.id()));
    executeTicks(game, 2);
    expect(silo.level()).toBe(2);
    // Upgrade cooldown + one launch = fully on cooldown.
    silo.launch();
    expect(silo.missileTimerQueue()).toHaveLength(2);
    expect(silo.isInCooldown()).toBe(true);

    silo.decreaseLevel();
    expect(silo.level()).toBe(1);
    expect(silo.missileTimerQueue()).toHaveLength(1);
    expect(silo.isInCooldown()).toBe(true);
  });
});
