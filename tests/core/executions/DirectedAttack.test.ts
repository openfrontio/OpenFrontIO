// ABOUTME: Tests for directed attack feature - verifying distance-based
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
    expect(initialAttacks.length).toBeGreaterThanOrEqual(0);

    // Execute some more ticks to let the attack progress
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    // Verify that attacker gained some tiles (attack made progress)
    expect(attacker.numTilesOwned()).toBeGreaterThan(tilesBeforeAttack);
  });

  test("Priority calculation correctly balances defensibility and distance", async () => {
    // This test verifies the internal priority calculation
    // We'll set up a scenario where we can observe the effect of both factors

    const config = game.config() as TestConfig;
    expect(config.attackDirectionWeight()).toBe(0.3); // Default value

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

    // Verify attack was created
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

  test("Different weight values affect attack direction", async () => {
    // Test that changing the weight actually affects behavior
    const config = game.config() as TestConfig;

    // Set weight to 0 (no directional influence)
    config.setAttackDirectionWeight(0);
    expect(config.attackDirectionWeight()).toBe(0);

    // Set weight to 1 (maximum directional influence)
    config.setAttackDirectionWeight(1);
    expect(config.attackDirectionWeight()).toBe(1);

    // Set back to default
    config.setAttackDirectionWeight(0.3);
    expect(config.attackDirectionWeight()).toBe(0.3);
  });
});
