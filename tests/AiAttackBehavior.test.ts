import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

describe("Ai Attack Behavior", () => {
  let game: Game;
  let bot: Player;
  let human: Player;
  let attackBehavior: AiAttackBehavior;

  // Helper function for basic test setup
  async function setupTestEnvironment() {
    const testGame = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    // Add players
    const botInfo = new PlayerInfo(
      "bot_test",
      PlayerType.Bot,
      null,
      "bot_test",
    );
    const humanInfo = new PlayerInfo(
      "human_test",
      PlayerType.Human,
      null,
      "human_test",
    );
    testGame.addPlayer(botInfo);
    testGame.addPlayer(humanInfo);

    const testBot = testGame.player("bot_test");
    const testHuman = testGame.player("human_test");

    // Assign territories
    let landTileCount = 0;
    testGame.map().forEachTile((tile) => {
      if (!testGame.map().isLand(tile)) return;
      (landTileCount++ % 2 === 0 ? testBot : testHuman).conquer(tile);
    });

    // Add troops
    testBot.addTroops(5000);
    testHuman.addTroops(5000);

    // Skip spawn phase
    while (testGame.inSpawnPhase()) {
      testGame.executeNextTick();
    }

    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      testBot,
      0.5,
      0.5,
      0.2,
    );

    return { testGame, testBot, testHuman, behavior };
  }

  // Helper functions for tile assignment
  function assignAlternatingLandTiles(
    game: Game,
    players: Player[],
    totalTiles: number,
  ) {
    let assigned = 0;
    game.map().forEachTile((tile) => {
      if (assigned >= totalTiles) return;
      if (!game.map().isLand(tile)) return;
      const player = players[assigned % players.length];
      player.conquer(tile);
      assigned++;
    });
  }

  beforeEach(async () => {
    const env = await setupTestEnvironment();
    game = env.testGame;
    bot = env.testBot;
    human = env.testHuman;
    attackBehavior = env.behavior;
  });

  test("bot cannot attack allied player", () => {
    // Form alliance (bot creates request to human)
    const allianceRequest = bot.createAllianceRequest(human);
    allianceRequest?.accept();

    expect(bot.isAlliedWith(human)).toBe(true);

    // Count attacks before attempting attack
    const attacksBefore = bot.outgoingAttacks().length;

    // Attempt attack (should be blocked)
    attackBehavior.sendAttack(human);

    // Execute a few ticks to process the attacks
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    expect(bot.isAlliedWith(human)).toBe(true);
    expect(human.incomingAttacks()).toHaveLength(0);
    // Should be same number of attacks (no new attack created)
    expect(bot.outgoingAttacks()).toHaveLength(attacksBefore);
  });

  test("nation cannot attack allied player", () => {
    // Create nation
    const nationInfo = new PlayerInfo(
      "nation_test",
      PlayerType.Nation,
      null,
      "nation_test",
    );
    game.addPlayer(nationInfo);
    const nation = game.player("nation_test");

    // Use helper for tile assignment
    assignAlternatingLandTiles(game, [bot, human, nation], 21); // 21 to ensure each gets 7 tiles

    nation.addTroops(1000);

    const nationBehavior = new AiAttackBehavior(
      new PseudoRandom(42),
      game,
      nation,
      0.5,
      0.5,
      0.2,
    );

    // Alliance between nation and human
    const allianceRequest = nation.createAllianceRequest(human);
    allianceRequest?.accept();

    expect(nation.isAlliedWith(human)).toBe(true);

    const attacksBefore = nation.outgoingAttacks().length;
    nation.addTroops(50_000);

    // Nation tries to attack ally (should be blocked)
    nationBehavior.sendAttack(human);

    // Execute a few ticks to process the attacks
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    expect(nation.isAlliedWith(human)).toBe(true);
    expect(nation.outgoingAttacks()).toHaveLength(attacksBefore);
  });
});
