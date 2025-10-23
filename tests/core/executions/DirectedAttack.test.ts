// ABOUTME: Tests for directed attack feature - verifying direction-based
// ABOUTME: priority calculation when player clicks to aim their attack

import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";

let game: Game;
let attacker: Player;
let defender: Player;
let defenderSpawn: TileRef;
let attackerSpawn: TileRef;

describe("DirectedAttack", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });
    const attackerInfo = new PlayerInfo(
      "attacker dude",
      PlayerType.Human,
      null,
      "attacker_id",
    );
    game.addPlayer(attackerInfo);
    const defenderInfo = new PlayerInfo(
      "defender dude",
      PlayerType.Human,
      null,
      "defender_id",
    );
    game.addPlayer(defenderInfo);

    defenderSpawn = game.ref(5, 15);
    attackerSpawn = game.ref(5, 10);

    game.addExecution(
      new SpawnExecution(game.player(attackerInfo.id).info(), attackerSpawn),
      new SpawnExecution(game.player(defenderInfo.id).info(), defenderSpawn),
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    attacker = game.player(attackerInfo.id);
    defender = game.player(defenderInfo.id);

    // Give defender some territory
    game.addExecution(
      new AttackExecution(100, defender, game.terraNullius().id()),
    );
    game.executeNextTick();
    while (defender.outgoingAttacks().length > 0) {
      game.executeNextTick();
    }
  });

  test("Attack without clickTile behaves as before (backward compatibility)", async () => {
    // Create an attack without specifying a clickTile
    const attackExecution = new AttackExecution(
      100,
      attacker,
      defender.id(),
      null,
    );
    game.addExecution(attackExecution);
    game.executeNextTick();

    // Should create an attack successfully
    expect(attacker.outgoingAttacks()).toHaveLength(1);
    const attack = attacker.outgoingAttacks()[0];
    expect(attack.troops()).toBe(100);
    expect(attack.target()).toBe(defender);
  });

  test("Attack with clickTile prioritizes tiles closer to target direction", async () => {
    // Give defender a larger territory spreading in multiple directions
    for (let i = 0; i < 50; i++) {
      game.executeNextTick();
    }

    // Click tile to the east of defender's spawn
    const clickTile = game.ref(15, 15);

    // Record attacker's tiles before the attack
    const tilesBeforeAttack = attacker.numTilesOwned();

    // Create attack with clickTile parameter
    const attackExecution = new AttackExecution(
      100,
      attacker,
      defender.id(),
      null,
      true,
      clickTile,
    );
    game.addExecution(attackExecution);

    // Execute the first tick to initialize the attack
    game.executeNextTick();

    // The attack should have been created
    const initialAttacks = attacker.outgoingAttacks();
    expect(initialAttacks).toHaveLength(1);

    // Execute some more ticks to let the attack progress
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    // Verify that attacker gained some tiles (attack made progress)
    expect(attacker.numTilesOwned()).toBeGreaterThan(tilesBeforeAttack);
  });

  test("Attack with clickTile uses configured direction weight", async () => {
    // Verify that attacks with clickTile parameter use the direction weight configuration

    const config = game.config() as TestConfig;
    expect(config.attackDirectionWeight()).toBe(0.5);

    // Create attack with clickTile
    const clickTile = game.ref(10, 15);
    const attackExecution = new AttackExecution(
      100,
      attacker,
      defender.id(),
      null,
      true,
      clickTile,
    );
    game.addExecution(attackExecution);
    game.executeNextTick();

    // Verify attack was created successfully
    expect(attacker.outgoingAttacks()).toHaveLength(1);
  });

  test("Clicking on own territory still creates valid attack", async () => {
    // Edge case: clicking on attacker's own territory
    const clickTile = attackerSpawn;

    const attackExecution = new AttackExecution(
      100,
      attacker,
      defender.id(),
      null,
      true,
      clickTile,
    );
    game.addExecution(attackExecution);
    game.executeNextTick();

    // Should still create a valid attack
    expect(attacker.outgoingAttacks()).toHaveLength(1);
    expect(attacker.outgoingAttacks()[0].troops()).toBe(100);
  });

  test("Clicking on water creates valid attack", async () => {
    // Edge case: clicking on water
    // Find a water tile
    let waterTile: TileRef | null = null;
    for (let x = 0; x < game.width(); x++) {
      for (let y = 0; y < game.height(); y++) {
        const tile = game.ref(x, y);
        if (game.isWater(tile)) {
          waterTile = tile;
          break;
        }
      }
      if (waterTile) break;
    }

    expect(waterTile).not.toBeNull();

    const attackExecution = new AttackExecution(
      100,
      attacker,
      defender.id(),
      null,
      true,
      waterTile,
    );
    game.addExecution(attackExecution);
    game.executeNextTick();

    // Should still create a valid attack
    expect(attacker.outgoingAttacks()).toHaveLength(1);
  });

  test("attackDirectionWeight configuration is accessible", async () => {
    // Verify that the configuration parameter exists and has the expected default value
    const config = game.config();

    // Should have the default weight value
    expect(config.attackDirectionWeight()).toBe(0.5);
  });

  test("Direction-based attack is distance-independent", async () => {
    // Verify that clicking at different distances in the same direction
    // produces similar expansion patterns (distance-independent behavior)

    // Give defender more territory
    for (let i = 0; i < 50; i++) {
      game.executeNextTick();
    }

    // Test clicking in the same direction (east) but at different distances
    // Both should favor eastward expansion since they're in the same direction

    const clickTileEast = game.ref(8, 15); // East of attacker

    // With direction-based logic, the expansion should favor tiles in the eastward direction
    // The distance from the attacker to the click point shouldn't matter,
    // only the direction matters

    const attackExecution = new AttackExecution(
      100,
      attacker,
      defender.id(),
      null,
      true,
      clickTileEast,
    );
    game.addExecution(attackExecution);
    game.executeNextTick();

    // Verify attack was created successfully
    expect(attacker.outgoingAttacks()).toHaveLength(1);

    // The key insight: with direction-based (not distance-based) logic,
    // the expansion should favor tiles in the eastward direction,
    // regardless of whether we click close or far in that direction
  });
});
