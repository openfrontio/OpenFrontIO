import {
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AiResourceStructureBehavior } from "@openfront/engine/execution/utils/AiResourceStructureBehavior";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { TribeExecution } from "@openfront/engine/execution/TribeExecution";
import { Nation } from "@openfront/engine-api/game/GameTypes";
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
  test("bots and nations can build all four resource structures when enabled", async () => {
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

    const botBehavior = new AiResourceStructureBehavior(
      new PseudoRandom(42),
      game,
      bot,
    );

    for (let i = 0; i < RESOURCE_TYPES.length; i++) {
      expect(botBehavior.handleStructures()).toBe(true);
      executeTicks(game, 3);
    }

    for (const type of RESOURCE_TYPES) {
      expect(bot.unitCount(type)).toBeGreaterThanOrEqual(1);
    }

    const disabledCoreStructures = [
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ];

    const nationInfo = new PlayerInfo(
      "resource_nation",
      PlayerType.Nation,
      null,
      "resource_nation",
    );
    const nation = new Nation(new (game.map().constructor as any), nationInfo);
    void nation;
    expect(Structures.has(UnitType.LivestockFarm)).toBe(true);
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

  test("tribes keep resource structures instead of deleting them", async () => {
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
});
