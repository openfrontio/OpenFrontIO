import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AiResourceStructureBehavior } from
  "@openfront/engine/execution/utils/AiResourceStructureBehavior";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { TribeExecution } from "@openfront/engine/execution/TribeExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const RESOURCE_TYPES = [
  UnitType.LivestockFarm,
  UnitType.OilMine,
  UnitType.GoldMine,
  UnitType.DiamondMine,
] as const;

function giveAllPassableLand(game: Game, player: Player): void {
  game.map().forEachTile((tile) => {
    if (game.map().isLand(tile) && !game.map().isImpassable(tile)) {
      player.conquer(tile);
    }
  });
}

describe("AI resource structures", () => {
  test("resource AI can build all four structures", async () => {
    const game = await setup("big_plains", {
      aiResourceStructures: true,
      infiniteGold: true,
      instantBuild: true,
    });

    const botInfo = new PlayerInfo(
      "resource_bot",
      PlayerType.Bot,
      null,
      "resource_bot",
    );
    game.addPlayer(botInfo);
    const bot = game.player(botInfo.id);
    giveAllPassableLand(game, bot);

    const behavior = new AiResourceStructureBehavior(
      new PseudoRandom(42),
      game,
      bot,
    );

    for (let i = 0; i < RESOURCE_TYPES.length; i++) {
      expect(behavior.handleStructures()).toBe(true);
      executeTicks(game, 3);
    }

    for (const type of RESOURCE_TYPES) {
      expect(bot.unitCount(type)).toBe(1);
    }
  });

  test("the config option disables AI resource construction", async () => {
    const game = await setup("big_plains", {
      aiResourceStructures: false,
      infiniteGold: true,
      instantBuild: true,
    });

    const botInfo = new PlayerInfo(
      "resource_bot_disabled",
      PlayerType.Bot,
      null,
      "resource_bot_disabled",
    );
    game.addPlayer(botInfo);
    const bot = game.player(botInfo.id);
    giveAllPassableLand(game, bot);

    const behavior = new AiResourceStructureBehavior(
      new PseudoRandom(42),
      game,
      bot,
    );

    expect(behavior.handleStructures()).toBe(false);
    expect(
      RESOURCE_TYPES.reduce((sum, type) => sum + bot.unitCount(type), 0),
    ).toBe(0);
  });

  test("tribe execution builds and keeps resource structures", async () => {
    const game = await setup("big_plains", {
      aiResourceStructures: true,
      infiniteGold: true,
      instantBuild: true,
    });

    const botInfo = new PlayerInfo(
      "resource_bot_execution",
      PlayerType.Bot,
      null,
      "resource_bot_execution",
    );
    game.addPlayer(botInfo);
    const bot = game.player(botInfo.id);
    giveAllPassableLand(game, bot);

    const execution = new TribeExecution(bot) as any;
    execution.init(game);
    execution.attackRate = 1;
    execution.attackTick = 0;

    execution.tick(0);
    execution.tick(1);
    executeTicks(game, 3);

    const before = RESOURCE_TYPES.reduce(
      (sum, type) => sum + bot.unitCount(type),
      0,
    );
    expect(before).toBeGreaterThanOrEqual(1);

    execution.tick(2);
    executeTicks(game, 3);

    const after = RESOURCE_TYPES.reduce(
      (sum, type) => sum + bot.unitCount(type),
      0,
    );
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test("nation execution builds resource structures when enabled", async () => {
    const game = await setup("big_plains", {
      aiResourceStructures: true,
      infiniteGold: true,
      instantBuild: true,
      disabledUnits: [
        UnitType.City,
        UnitType.Port,
        UnitType.Factory,
        UnitType.SAMLauncher,
        UnitType.MissileSilo,
      ],
    });

    const nationInfo = new PlayerInfo(
      "resource_nation",
      PlayerType.Nation,
      null,
      "resource_nation",
    );
    game.addPlayer(nationInfo);
    const nationPlayer = game.player(nationInfo.id);
    giveAllPassableLand(game, nationPlayer);

    const execution = new NationExecution(
      "resource_nation_game",
      new Nation(new Cell(10, 10), nationInfo),
    ) as any;
    execution.init(game);
    execution.attackRate = 1;
    execution.attackTick = 0;

    execution.tick(0);
    execution.tick(1);
    executeTicks(game, 3);

    const built = RESOURCE_TYPES.reduce(
      (sum, type) => sum + nationPlayer.unitCount(type),
      0,
    );
    expect(built).toBeGreaterThanOrEqual(1);
  });
  test("resource AI upgrades an existing mine before repeating it forever", async () => {
    const game = await setup("big_plains", {
      aiResourceStructures: true,
      infiniteGold: true,
      instantBuild: true,
      disabledUnits: [
        UnitType.LivestockFarm,
        UnitType.GoldMine,
        UnitType.DiamondMine,
      ],
    });

    const botInfo = new PlayerInfo(
      "resource_upgrade_bot",
      PlayerType.Bot,
      null,
      "resource_upgrade_bot",
    );
    game.addPlayer(botInfo);
    const bot = game.player(botInfo.id);
    giveAllPassableLand(game, bot);

    const behavior = new AiResourceStructureBehavior(
      new PseudoRandom(42),
      game,
      bot,
    );

    expect(behavior.handleStructures()).toBe(true);
    executeTicks(game, 3);

    const mine = bot.units(UnitType.OilMine)[0];
    expect(mine).toBeDefined();
    expect(mine.level()).toBe(1);

    expect(behavior.handleStructures()).toBe(true);
    expect(mine.level()).toBe(2);
  });

});
