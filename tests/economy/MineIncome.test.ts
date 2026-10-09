import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";
import { executeTicks } from "../util/utils";

describe("Mine economy", () => {
  let game: Game;
  let player: Player;

  const playerInfo = new PlayerInfo(
    "miner",
    PlayerType.Human,
    null,
    "miner_id",
  );

  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: false,
        instantBuild: true,
        infiniteTroops: true,
      },
      [playerInfo],
    );
    player = game.player(playerInfo.id);
    player.conquer(game.ref(0, 10));
    player.addGold(5_000_000n);
    game.addExecution(new PlayerExecution(player));
  });

  test("mines have distinct level-1 income rates", () => {
    expect(
      game.config().mineIncome(UnitType.OilMine, 1, player),
    ).toBe(10_000n);
    expect(
      game.config().mineIncome(UnitType.GoldMine, 1, player),
    ).toBe(15_000n);
    expect(
      game.config().mineIncome(UnitType.DiamondMine, 1, player),
    ).toBe(25_000n);
  });

  test("mine income scales with level", () => {
    expect(
      game.config().mineIncome(UnitType.OilMine, 3, player),
    ).toBe(30_000n);
    expect(
      game.config().mineIncome(UnitType.GoldMine, 2, player),
    ).toBe(30_000n);
    expect(
      game.config().mineIncome(UnitType.DiamondMine, 4, player),
    ).toBe(100_000n);
  });

  test("resource structures stop producing at their reserve cap", async () => {
    const target = game.ref(0, 10);
    const oilCost = game.unitInfo(UnitType.OilMine).cost(game, player);
    player.addGold(oilCost);

    game.addExecution(
      new ConstructionExecution(player, UnitType.OilMine, target),
    );
    game.executeNextTick();
    game.executeNextTick();

    const mine = player.units(UnitType.OilMine)[0];
    expect(mine).toBeDefined();

    executeTicks(game, 1300);

    expect(mine.resourceGoldProduced()).toBe(60_000n);

    const producedAtCap = mine.resourceGoldProduced();
    executeTicks(game, game.config().mineIncomeInterval() * 2);
    expect(mine.resourceGoldProduced()).toBe(producedAtCap);
  });

  test("a trade refill adds only 15 seconds of production", async () => {
    const target = game.ref(0, 10);
    const oilCost = game.unitInfo(UnitType.OilMine).cost(game, player);
    player.addGold(oilCost);

    game.addExecution(
      new ConstructionExecution(player, UnitType.OilMine, target),
    );
    game.executeNextTick();
    game.executeNextTick();

    const mine = player.units(UnitType.OilMine)[0];
    expect(mine).toBeDefined();

    mine.addResourceGoldProduced(60_000n);
    expect(mine.resourceGoldProduced()).toBe(60_000n);

    mine.refillResourceGoldProduced(
      game.config().resourceProductionTradeRefill(
        UnitType.OilMine,
        mine.level(),
        player,
      ),
    );
    expect(mine.resourceGoldProduced()).toBe(30_000n);
  });

  test("constructed mines generate income and are upgraded normally", () => {
    const target = game.ref(0, 10);
    const oilCost = game.unitInfo(UnitType.OilMine).cost(game, player);
    player.addGold(oilCost);

    game.addExecution(
      new ConstructionExecution(player, UnitType.OilMine, target),
    );
    game.executeNextTick();
    game.executeNextTick();

    const mine = player.units(UnitType.OilMine)[0];
    expect(mine).toBeDefined();
    expect(mine.isUnderConstruction()).toBe(false);

    const before = player.gold();
    for (let i = 0; i < game.config().mineIncomeInterval(); i++) {
      game.executeNextTick();
    }

    expect(player.gold() - before).toBeGreaterThanOrEqual(10_000n);
  });
});
