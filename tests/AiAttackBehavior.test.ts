import { AttackExecution } from "../src/core/execution/AttackExecution";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  GameMode,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
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

    // Provide an emoji behavior so sendAttack can run the full Nation code
    // path; the attack on an ally must be blocked by AttackExecution's
    // alliance check regardless of what the AI decides.
    const nationRandom = new PseudoRandom(42);
    const nationBehavior = new AiAttackBehavior(
      nationRandom,
      game,
      nation,
      0.5,
      0.5,
      0.2,
      undefined,
      new NationEmojiBehavior(nationRandom, game, nation),
    );

    // Alliance between nation and human
    const allianceRequest = nation.createAllianceRequest(human);
    allianceRequest?.accept();

    expect(nation.isAlliedWith(human)).toBe(true);

    const attacksBefore = nation.outgoingAttacks().length;
    nation.addTroops(50_000);

    // Force the attack past shouldAttack's dice gate so the alliance check
    // in AttackExecution is the layer under test, regardless of RNG outcome.
    nationBehavior.sendAttack(human, true);

    // Execute a few ticks to process the attacks
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    expect(nation.isAlliedWith(human)).toBe(true);
    expect(nation.outgoingAttacks()).toHaveLength(attacksBefore);
  });
});

describe("Hard/Impossible troop floor", () => {
  /**
   * Sets up a game where a nation attacker borders a neighbor and a bot target.
   * All players get alternating land tiles so they share borders.
   */
  async function setupTroopFloorTest(difficulty: Difficulty) {
    const testGame = await setup("big_plains", {
      difficulty,
    });

    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Nation,
      null,
      "attacker_id",
    );
    const neighborInfo = new PlayerInfo(
      "neighbor",
      PlayerType.Human,
      null,
      "neighbor_id",
    );
    const botInfo = new PlayerInfo(
      "target_bot",
      PlayerType.Bot,
      null,
      "bot_id",
    );
    testGame.addPlayer(attackerInfo);
    testGame.addPlayer(neighborInfo);
    testGame.addPlayer(botInfo);

    const attacker = testGame.player("attacker_id");
    const neighbor = testGame.player("neighbor_id");
    const bot = testGame.player("bot_id");

    // Assign alternating tiles so all three share borders
    let assigned = 0;
    testGame.map().forEachTile((tile) => {
      if (assigned >= 90) return;
      if (!testGame.map().isLand(tile)) return;
      const players = [attacker, neighbor, bot];
      players[assigned % 3].conquer(tile);
      assigned++;
    });

    // Give bot target a tiny amount of troops so it's a valid target
    bot.addTroops(100);

    // Nation type requires alliance and emoji behaviors
    const mockEmoji = {
      maybeSendAttackEmoji: vi.fn(),
      sendEmoji: vi.fn(),
    } as any;
    const mockAlliance = { maybeBetray: vi.fn() } as any;

    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      attacker,
      0.5, // triggerRatio
      0.3, // reserveRatio
      0.2, // expandRatio
      mockAlliance,
      mockEmoji,
    );

    return { testGame, attacker, neighbor, bot, behavior };
  }

  it("Hard: caps attack troops so nation retains 75% of strongest neighbor's troops", async () => {
    const { testGame, attacker, neighbor, behavior } =
      await setupTroopFloorTest(Difficulty.Hard);

    attacker.addTroops(100_000);
    neighbor.addTroops(90_000);

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    // Attack the neighbor directly (already shares border, is Human type)
    const result = behavior.sendAttack(neighbor);

    expect(result).toBe(true);
    const exec = addExecSpy.mock.calls.find(
      (c) => c[0].constructor.name === "AttackExecution",
    )?.[0] as any;
    expect(exec).toBeDefined();
    // Nation must retain at least 75% of strongest non-allied neighbor's troops
    const minRetained = Math.ceil(neighbor.troops() * 0.75);
    const expectedCap = Math.max(0, attacker.troops() - minRetained);
    expect(exec.startTroops).toBeLessThanOrEqual(expectedCap);
  });

  it("Hard: prevents attack when nation troops < 75% of strongest neighbor", async () => {
    const { testGame, attacker, neighbor, bot, behavior } =
      await setupTroopFloorTest(Difficulty.Hard);

    // Attacker has fewer troops than 75% of neighbor
    attacker.addTroops(3_000);
    neighbor.addTroops(5_000);
    // minRetained = ceil(5_000 * 0.75) = 3_750
    // troopSendCap = max(0, 3_000 - 3_750) = 0
    // Attack should be blocked entirely

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    const result = behavior.sendAttack(bot);

    expect(result).toBe(false);
    expect(addExecSpy).not.toHaveBeenCalled();
  });

  it("Hard: skips attack when capped troops are < 20% of target's troops", async () => {
    const { testGame, attacker, neighbor, behavior } =
      await setupTroopFloorTest(Difficulty.Hard);

    // Add a strong human target sharing borders
    const targetInfo = new PlayerInfo(
      "strong_target",
      PlayerType.Human,
      null,
      "target_id",
    );
    testGame.addPlayer(targetInfo);
    const target = testGame.player("target_id");

    // Give target some tiles from the attacker's pool
    let stolen = 0;
    for (const tile of Array.from(attacker.tiles())) {
      if (stolen >= 20) break;
      target.conquer(tile);
      stolen++;
    }

    attacker.addTroops(100_000);
    neighbor.addTroops(100_000);
    target.addTroops(300_000);
    // troopSendCap = 100_000 - ceil(100_000 * 0.75) = 25_000
    // 20% of target = 300_000 * 0.2 = 60_000
    // 25_000 < 60_000 → attack should be blocked

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    const result = behavior.sendAttack(target);

    expect(result).toBe(false);
    expect(addExecSpy).not.toHaveBeenCalled();
  });

  it("Impossible: caps attack troops so nation retains 90% of strongest neighbor's troops", async () => {
    const { testGame, attacker, neighbor, behavior } =
      await setupTroopFloorTest(Difficulty.Impossible);

    attacker.addTroops(100_000);
    neighbor.addTroops(90_000);

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    // Attack the neighbor directly (already shares border, is Human type)
    const result = behavior.sendAttack(neighbor);

    expect(result).toBe(true);
    const exec = addExecSpy.mock.calls.find(
      (c) => c[0].constructor.name === "AttackExecution",
    )?.[0] as any;
    expect(exec).toBeDefined();
    // Nation must retain at least 90% of strongest non-allied neighbor's troops
    const minRetained = Math.ceil(neighbor.troops() * 0.9);
    const expectedCap = Math.max(0, attacker.troops() - minRetained);
    expect(exec.startTroops).toBeLessThanOrEqual(expectedCap);
  });

  it("Easy: no troop floor — sends based on reserve only", async () => {
    const { testGame, attacker, neighbor, bot, behavior } =
      await setupTroopFloorTest(Difficulty.Easy);

    attacker.addTroops(100_000);
    neighbor.addTroops(90_000);
    // No cap on Easy — sends full reserve amount

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    const result = behavior.sendAttack(bot);

    expect(result).toBe(true);
    const exec = addExecSpy.mock.calls.find(
      (c) => c[0].constructor.name === "AttackExecution",
    )?.[0] as any;
    expect(exec).toBeDefined();
    // On Easy, no troop floor applies — troops are only limited by the reserve ratio
    expect(exec.startTroops).toBeGreaterThan(0);
    // Verify the troops exceed what the Hard cap would have been
    const hardCap = Math.max(
      0,
      attacker.troops() - Math.ceil(neighbor.troops() * 0.75),
    );
    expect(exec.startTroops).toBeGreaterThan(hardCap);
  });

  it("Hard: sendAttack uncapped when nation has no player neighbors", async () => {
    const testGame = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
      difficulty: Difficulty.Hard,
    });

    // Give bot only half the land so there's unowned land to attack via sendAttack
    const botInfo = new PlayerInfo("lone_bot", PlayerType.Bot, null, "lone_id");
    testGame.addPlayer(botInfo);
    const bot = testGame.player("lone_id");
    let assigned = 0;
    testGame.map().forEachTile((tile) => {
      if (!testGame.map().isLand(tile)) return;
      if (assigned % 2 === 0) bot.conquer(tile);
      assigned++;
    });
    bot.addTroops(100_000);

    // No player neighbors — troopSendCap should return Infinity
    expect(bot.nearby().filter((n) => n.isPlayer()).length).toBe(0);

    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      bot,
      0.5,
      0.3,
      0.2,
    );

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    // sendAttack goes through sendLandAttack which applies troopSendCap.
    // With no player neighbors, troopSendCap returns Infinity (no cap).
    const result = behavior.sendAttack(testGame.terraNullius());

    expect(result).toBe(true);
    const exec = addExecSpy.mock.calls.find(
      (c) => c[0].constructor.name === "AttackExecution",
    )?.[0] as any;
    expect(exec).toBeDefined();
    // No cap applies, so troops should be the full reserve amount
    expect(exec.startTroops).toBeGreaterThan(40_000);
  });

  it("Team: troopSendCap returns Infinity — no cap in team games", async () => {
    // Same setup as Hard cap test but with GameMode.Team
    const testGame = await setup("big_plains", {
      difficulty: Difficulty.Hard,
      gameMode: GameMode.Team,
      playerTeams: 2,
    });

    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Nation,
      null,
      "attacker_id",
    );
    const neighborInfo = new PlayerInfo(
      "neighbor",
      PlayerType.Human,
      null,
      "neighbor_id",
    );
    const botInfo = new PlayerInfo(
      "target_bot",
      PlayerType.Bot,
      null,
      "bot_id",
    );
    testGame.addPlayer(attackerInfo);
    testGame.addPlayer(neighborInfo);
    testGame.addPlayer(botInfo);

    const attacker = testGame.player("attacker_id");
    const neighbor = testGame.player("neighbor_id");
    const bot = testGame.player("bot_id");

    let assigned = 0;
    testGame.map().forEachTile((tile) => {
      if (assigned >= 90) return;
      if (!testGame.map().isLand(tile)) return;
      const players = [attacker, neighbor, bot];
      players[assigned % 3].conquer(tile);
      assigned++;
    });
    bot.addTroops(100);

    const mockEmoji = {
      maybeSendAttackEmoji: vi.fn(),
      sendEmoji: vi.fn(),
    } as any;
    const mockAlliance = { maybeBetray: vi.fn() } as any;

    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      attacker,
      0.5,
      0.3,
      0.2,
      mockAlliance,
      mockEmoji,
    );

    // In FFA Hard, attacker with 100k and neighbor with 90k would cap
    // attack troops to 32.5k. In Team mode, troopSendCap returns Infinity
    // so the attack is not capped by neighbor strength.
    attacker.addTroops(100_000);
    neighbor.addTroops(90_000);

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    const result = behavior.sendAttack(bot);

    expect(result).toBe(true);
    const exec = addExecSpy.mock.calls.find(
      (c) => c[0].constructor.name === "AttackExecution",
    )?.[0] as any;
    expect(exec).toBeDefined();
    // In FFA Hard, troops would be capped to 32.5k. In Team mode, no cap.
    expect(exec.startTroops).toBeGreaterThan(32_500);
  });

  it("Team: isAttackTooWeak returns false — weak attacks allowed in team games", async () => {
    // Same setup as the FFA "skips attack when capped troops are < 20%" test
    // but with GameMode.Team. In FFA Hard, the attack would be blocked.
    const testGame = await setup("big_plains", {
      difficulty: Difficulty.Hard,
      gameMode: GameMode.Team,
      playerTeams: 2,
    });

    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Nation,
      null,
      "attacker_id",
    );
    const neighborInfo = new PlayerInfo(
      "neighbor",
      PlayerType.Human,
      null,
      "neighbor_id",
    );
    testGame.addPlayer(attackerInfo);
    testGame.addPlayer(neighborInfo);

    const attacker = testGame.player("attacker_id");
    const neighbor = testGame.player("neighbor_id");

    // Add a strong human target sharing borders
    const targetInfo = new PlayerInfo(
      "strong_target",
      PlayerType.Human,
      null,
      "target_id",
    );
    testGame.addPlayer(targetInfo);
    const target = testGame.player("target_id");

    let assigned = 0;
    testGame.map().forEachTile((tile) => {
      if (assigned >= 90) return;
      if (!testGame.map().isLand(tile)) return;
      const players = [attacker, neighbor, target];
      players[assigned % 3].conquer(tile);
      assigned++;
    });

    const mockEmoji = {
      maybeSendAttackEmoji: vi.fn(),
      sendEmoji: vi.fn(),
    } as any;
    const mockAlliance = { maybeBetray: vi.fn() } as any;

    const behavior = new AiAttackBehavior(
      new PseudoRandom(42),
      testGame,
      attacker,
      0.5,
      0.3,
      0.2,
      mockAlliance,
      mockEmoji,
    );

    attacker.addTroops(100_000);
    neighbor.addTroops(100_000);
    target.addTroops(300_000);
    // In FFA Hard: troopSendCap = 25k, 20% of target = 60k → blocked.
    // In Team mode: isAttackTooWeak returns false, so the attack proceeds
    // even though troops would be below 20% of the target.

    const addExecSpy = vi.spyOn(testGame, "addExecution");
    const result = behavior.sendAttack(target);

    expect(result).toBe(true);
    const exec = addExecSpy.mock.calls.find(
      (c) => c[0].constructor.name === "AttackExecution",
    )?.[0] as any;
    expect(exec).toBeDefined();
    expect(exec.startTroops).toBeGreaterThan(0);
  });

  it("Hard: nation under attack bypasses troopSendCap and isAttackTooWeak", async () => {
    const { testGame, attacker, neighbor, behavior } =
      await setupTroopFloorTest(Difficulty.Hard);

    // Neighbor has far more troops, so the normal cap would be 0
    attacker.addTroops(100_000);
    neighbor.addTroops(200_000);
    // Normal cap = max(0, 100k - ceil(200k * 0.75)) = max(0, 100k - 150k) = 0
    // Without the bypass, the nation couldn't attack at all.
    const normalCap = Math.max(
      0,
      attacker.troops() - Math.ceil(neighbor.troops() * 0.75),
    );
    expect(normalCap).toBe(0);

    // Simulate the neighbor attacking with 50k troops
    testGame.addExecution(new AttackExecution(50_000, neighbor, attacker.id()));
    testGame.executeNextTick();
    expect(attacker.incomingAttacks().length).toBeGreaterThan(0);

    // With incoming attacks, troopSendCap raises to at least totalIncoming
    const addExecSpy = vi.spyOn(testGame, "addExecution");
    const result = behavior.sendAttack(neighbor);

    expect(result).toBe(true);
    const exec = addExecSpy.mock.calls.find(
      (c) => c[0].constructor.name === "AttackExecution",
    )?.[0] as any;
    expect(exec).toBeDefined();
    // The bypass allows retaliation with at least the incoming 50k
    expect(exec.startTroops).toBeGreaterThanOrEqual(50_000);
  });
});
