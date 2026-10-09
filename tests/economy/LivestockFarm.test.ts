import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";

describe("LivestockFarm economy and troop generation", () => {
  let game: Game;
  let player: Player;

  const playerInfo = new PlayerInfo(
    "rancher",
    PlayerType.Human,
    null,
    "rancher_id",
  );

  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: false,
        instantBuild: true,
        infiniteTroops: false,
      },
      [playerInfo],
    );
    player = game.player(playerInfo.id);
    player.conquer(game.ref(0, 10));
    player.addGold(5_000_000n);
    game.addExecution(new PlayerExecution(player));
  });

  test("livestock farms have level-1 income and scale with level", () => {
    expect(
      game.config().mineIncome(UnitType.LivestockFarm, 1, player),
    ).toBe(8_000n);
    expect(
      game.config().mineIncome(UnitType.LivestockFarm, 2, player),
    ).toBe(16_000n);
    expect(
      game.config().mineIncome(UnitType.LivestockFarm, 3, player),
    ).toBe(24_000n);
  });

  test("constructed livestock farm increases maxTroops and troopIncreaseRate", () => {
    const baseMaxTroops = game.config().maxTroops(player);
    const baseTroopRate = game.config().troopIncreaseRate(player);

    const target = game.ref(0, 10);
    game.addExecution(
      new ConstructionExecution(player, UnitType.LivestockFarm, target),
    );
    game.executeNextTick();
    game.executeNextTick();

    const farm = player.units(UnitType.LivestockFarm)[0];
    expect(farm).toBeDefined();
    expect(farm.isUnderConstruction()).toBe(false);

    // Max troops increased by 100,000
    const newMaxTroops = game.config().maxTroops(player);
    expect(newMaxTroops).toBe(baseMaxTroops + 100_000);

    // Troop generation rate is accelerated by 15%
    const newTroopRate = game.config().troopIncreaseRate(player);
    expect(newTroopRate).toBeGreaterThan(baseTroopRate);
  });

  test("constructed livestock farm generates periodic income", () => {
    const target = game.ref(0, 10);
    game.addExecution(
      new ConstructionExecution(player, UnitType.LivestockFarm, target),
    );
    game.executeNextTick();
    game.executeNextTick();

    const farm = player.units(UnitType.LivestockFarm)[0];
    expect(farm).toBeDefined();

    const beforeGold = player.gold();
    for (let i = 0; i < game.config().mineIncomeInterval(); i++) {
      game.executeNextTick();
    }

    expect(player.gold() - beforeGold).toBeGreaterThanOrEqual(8_000n);
  });
});
