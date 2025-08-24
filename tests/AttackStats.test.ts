import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GOLD_INDEX_WAR, GOLD_INDEX_WORK } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;

describe("AttackStats", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteTroops: true }, [
      new PlayerInfo("player1", PlayerType.Human, "player1", "player1"),
      new PlayerInfo("player2", PlayerType.Human, "player2", "player2"),
    ]);

    player1 = game.player("player1");
    player2 = game.player("player2");

    game.addExecution(new SpawnExecution(player1.info(), game.ref(50, 50)));
    game.addExecution(new SpawnExecution(player2.info(), game.ref(50, 55)));

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("should increase war gold stat when a player is eliminated", () => {
    expect(player1.sharesBorderWith(player2)).toBeTruthy();
    performAttack(game, player1, player2);
    expectWarGoldStatIsIncreasedAfterKill(game, player1, player2);
  });

  test("should increase war gold stat when elimination occurs via territory annexation", () => {
    // Mark every tile on the map as owned by player1
    for (let x = 0; x < game.map().width(); x++) {
      for (let y = 0; y < game.map().height(); y++) {
        player1.conquer(game.ref(x, y));
      }
    }
    // Place tiles of player2 in the center of the map
    const centerX = Math.round(game.map().width() / 2);
    const centerY = Math.round(game.map().height() / 2);
    for (let x = -20; x < 20; x++) {
      for (let y = -20; y < 20; y++) {
        player2.conquer(game.ref(centerX + x, centerY + y));
      }
    }

    performAttack(game, player1, player2);
    expectWarGoldStatIsIncreasedAfterKill(game, player1, player2);
  });
});

function expectWarGoldStatIsIncreasedAfterKill(
  game: Game,
  attacker: Player,
  defender: Player,
) {
  // Verify that the defender was killed as a result of the attack
  expect(attacker.isAlive()).toBeTruthy();
  expect(defender.isAlive()).toBeFalsy();

  const attackerStats = game.stats().stats()[attacker.clientID()!];
  const defenderStats = game.stats().stats()[defender.clientID()!];

  // Verify that all defender's gold was recorded as war gold in the attacker's stats
  expect(attackerStats?.gold?.[GOLD_INDEX_WAR]).toBeDefined();
  expect(defenderStats?.gold?.[GOLD_INDEX_WORK]).toBeDefined();
  expect(attackerStats?.gold?.[GOLD_INDEX_WAR]).toBe(
    defenderStats?.gold?.reduce((acc, g) => acc + g, 0n),
  );
}

function performAttack(game: Game, attacker: Player, defender: Player) {
  // Execute the attack
  game.addExecution(
    new AttackExecution(attacker.troops(), attacker, defender.id()),
  );
  // Wait for the attack to complete
  do {
    game.executeNextTick();
  } while (attacker.outgoingAttacks().length > 0);
}
