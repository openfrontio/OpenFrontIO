import { AttackExecution } from "../src/core/execution/AttackExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

/**
 * Regression tests for BUG-02: handleDeadDefender sweep logic.
 *
 * These tests verify that:
 * 1. Iterating over target.tiles() with Array.from() prevents iterator
 *    invalidation when conquer() modifies the live collection.
 * 2. A defender with many tiles is fully absorbed (all tiles transferred).
 * 3. The loop terminates early when no tiles remain (no infinite loop).
 */

let game: Game;
const gameID: GameID = "game_id";
let attacker: Player;
let defender: Player;

describe("handleDeadDefender sweep (BUG-02 regression)", () => {
  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const attackerInfo = new PlayerInfo(
      "attacker",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    const defenderInfo = new PlayerInfo(
      "defender",
      PlayerType.Human,
      null,
      "defender_id",
    );

    game.addPlayer(attackerInfo);
    game.addPlayer(defenderInfo);

    // Spawn attacker at (0, 0) region
    const attackerSpawn = game.ref(0, 0);
    game.addExecution(new SpawnExecution(gameID, attackerInfo, attackerSpawn));
    game.executeNextTick();

    // Spawn defender adjacent at (0, 5)
    const defenderSpawn = game.ref(0, 5);
    game.addExecution(new SpawnExecution(gameID, defenderInfo, defenderSpawn));
    game.executeNextTick();

    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);
  });

  test("should fully absorb a dead defender without runtime errors (snapshot safety)", async () => {
    // Give defender extra tiles to create a larger territory
    let extraTiles = 0;
    game.map().forEachTile((tile) => {
      if (extraTiles >= 30) return;
      if (
        game.owner(tile) !== attacker &&
        game.owner(tile) !== defender &&
        game.map().isLand(tile)
      ) {
        defender.conquer(tile);
        extraTiles++;
      }
    });

    const defenderTilesBefore = defender.numTilesOwned();
    expect(defenderTilesBefore).toBeGreaterThan(10);

    // Launch a massive attack to kill the defender
    game.addExecution(new AttackExecution(null, attacker, defender.id(), null));

    // Run enough ticks for the attack to finish and handleDeadDefender to fire
    for (let i = 0; i < 500; i++) {
      game.executeNextTick();
      if (!defender.isAlive()) break;
    }

    // After handleDeadDefender, defender should have no tiles
    expect(defender.isAlive()).toBe(false);
    expect(defender.numTilesOwned()).toBe(0);
  });

  test("should complete sweep without infinite loop (early break when empty)", async () => {
    // Attack and kill the defender
    game.addExecution(new AttackExecution(null, attacker, defender.id(), null));

    const startTime = Date.now();

    for (let i = 0; i < 500; i++) {
      game.executeNextTick();
      if (!defender.isAlive()) break;
    }

    const elapsed = Date.now() - startTime;

    // The sweep should complete quickly (no infinite loop)
    // 500 ticks should not take more than 10 seconds even on slow machines
    expect(elapsed).toBeLessThan(10000);
    expect(defender.numTilesOwned()).toBe(0);
  });

  test("should transfer all defender tiles to attacker or neighbors after sweep", async () => {
    // Give defender some extra tiles adjacent to attacker territory
    let extraTiles = 0;
    const defenderExtraTiles: TileRef[] = [];
    game.map().forEachTile((tile) => {
      if (extraTiles >= 20) return;
      if (
        game.owner(tile) !== attacker &&
        game.owner(tile) !== defender &&
        game.map().isLand(tile)
      ) {
        defender.conquer(tile);
        defenderExtraTiles.push(tile);
        extraTiles++;
      }
    });

    // Attack and kill the defender
    game.addExecution(new AttackExecution(null, attacker, defender.id(), null));

    for (let i = 0; i < 500; i++) {
      game.executeNextTick();
      if (!defender.isAlive()) break;
    }

    // All defender tiles should now belong to someone other than defender
    expect(defender.numTilesOwned()).toBe(0);

    // Attacker should have gained tiles
    expect(attacker.numTilesOwned()).toBeGreaterThan(0);
  });
});
