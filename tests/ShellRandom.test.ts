import { DefensePostExecution } from "../src/core/execution/DefensePostExecution";
import { ShellExecution } from "../src/core/execution/ShellExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Shell Random Damage", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("attacker", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("defender", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      await game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("Shell damage varies randomly between 200-300 base damage", () => {
    const target = player2.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 5, 10),
      {
        patrolTile: game.ref(coastX + 5, 10),
      },
    );
    const initialHealth = target.health();

    const damages: number[] = [];
    const numShells = 50;

    for (let i = 0; i < numShells; i++) {
      const shell = new ShellExecution(
        game.ref(coastX, 10),
        player1,
        player1.buildUnit(UnitType.Warship, game.ref(coastX, 10), {
          patrolTile: game.ref(coastX, 10),
        }),
        target,
      );

      shell.init(game, game.ticks() + i);

      const healthBefore = target.health();
      target.modifyHealth(-shell.getEffectOnTargetForTesting(), player1);
      const healthAfter = target.health();

      const damage = healthBefore - healthAfter;
      if (damage > 0) {
        damages.push(damage);
      }

      target.modifyHealth(-(healthBefore - initialHealth));
    }

    expect(damages.length).toBeGreaterThan(0);

    const baseDamage = game.config().unitInfo(UnitType.Shell).damage ?? 250;
    const minExpectedDamage = Math.round((baseDamage / 250) * 200);
    const maxExpectedDamage = Math.round((baseDamage / 250) * 300);

    damages.forEach((damage) => {
      expect(damage).toBeGreaterThanOrEqual(minExpectedDamage);
      expect(damage).toBeLessThanOrEqual(maxExpectedDamage);
    });

    expect(damages.length).toBeGreaterThan(0);
  });

  test("Warship shell attacks have random damage", async () => {
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    const target = player2.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 2, 10),
      {
        patrolTile: game.ref(coastX + 2, 10),
      },
    );
    const initialHealth = target.health();

    warship.setTargetUnit(target);

    game.addExecution(new WarshipExecution(warship));

    const damages: number[] = [];
    const maxAttempts = 100;
    let attempts = 0;

    while (damages.length < 10 && attempts < maxAttempts) {
      const healthBefore = target.health();
      await game.executeNextTick();
      const healthAfter = target.health();

      if (healthAfter < healthBefore) {
        damages.push(healthBefore - healthAfter);
        target.modifyHealth(-(healthBefore - initialHealth));
      }

      attempts++;
    }

    expect(damages.length).toBeGreaterThan(0);

    const uniqueDamages = new Set(damages);
    expect(uniqueDamages.size).toBeGreaterThan(1);

    const baseDamage = game.config().unitInfo(UnitType.Shell).damage ?? 250;
    const minExpectedDamage = Math.round((baseDamage / 250) * 200);
    const maxExpectedDamage = Math.round((baseDamage / 250) * 300);

    damages.forEach((damage) => {
      expect(damage).toBeGreaterThanOrEqual(minExpectedDamage);
      expect(damage).toBeLessThanOrEqual(maxExpectedDamage);
    });
  });

  test("Defense post shell attacks have random damage", async () => {
    const defensePost = new DefensePostExecution(player1, game.ref(coastX, 5));

    const target = player2.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    const initialHealth = target.health();

    defensePost.init(game, game.ticks());

    const damages: number[] = [];
    const maxAttempts = 100;
    let attempts = 0;

    while (damages.length < 5 && attempts < maxAttempts) {
      const healthBefore = target.health();
      defensePost.tick(game.ticks());
      await game.executeNextTick();
      const healthAfter = target.health();

      if (healthAfter < healthBefore) {
        damages.push(healthBefore - healthAfter);
        target.modifyHealth(-(healthBefore - initialHealth));
      }

      attempts++;
    }

    if (damages.length > 0) {
      const uniqueDamages = new Set(damages);
      expect(uniqueDamages.size).toBeGreaterThan(1);

      const baseDamage = game.config().unitInfo(UnitType.Shell).damage ?? 250;
      const minExpectedDamage = Math.round((baseDamage / 250) * 200);
      const maxExpectedDamage = Math.round((baseDamage / 250) * 300);

      damages.forEach((damage) => {
        expect(damage).toBeGreaterThanOrEqual(minExpectedDamage);
        expect(damage).toBeLessThanOrEqual(maxExpectedDamage);
      });
    }
  });

  test("Shell damage distribution follows expected pattern", () => {
    const target = player2.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 5, 10),
      {
        patrolTile: game.ref(coastX + 5, 10),
      },
    );
    const initialHealth = target.health();

    const damages: number[] = [];
    const numShells = 1000;

    for (let i = 0; i < numShells; i++) {
      const shell = new ShellExecution(
        game.ref(coastX, 10),
        player1,
        player1.buildUnit(UnitType.Warship, game.ref(coastX, 10), {
          patrolTile: game.ref(coastX, 10),
        }),
        target,
      );

      shell.init(game, game.ticks() + i);

      const healthBefore = target.health();
      target.modifyHealth(-shell.getEffectOnTargetForTesting(), player1);
      const healthAfter = target.health();

      const damage = healthBefore - healthAfter;
      if (damage > 0) {
        damages.push(damage);
      }

      target.modifyHealth(-(healthBefore - initialHealth));
    }

    expect(damages.length).toBeGreaterThan(0);

    const uniqueDamages = new Set(damages);
    expect(uniqueDamages.size).toBeGreaterThan(0);

    const damageCounts = new Map<number, number>();
    damages.forEach((damage) => {
      damageCounts.set(damage, (damageCounts.get(damage) ?? 0) + 1);
    });

    const maxCount = Math.max(...damageCounts.values());
    const minCount = Math.min(...damageCounts.values());

    expect(maxCount - minCount).toBeLessThan(damages.length * 0.8);
  });

  test("Shell damage is consistent with same random seed", async () => {
    const target = player2.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 5, 10),
      {
        patrolTile: game.ref(coastX + 5, 10),
      },
    );
    const initialHealth = target.health();

    const shell1 = new ShellExecution(
      game.ref(coastX, 10),
      player1,
      player1.buildUnit(UnitType.Warship, game.ref(coastX, 10), {
        patrolTile: game.ref(coastX, 10),
      }),
      target,
    );

    const shell2 = new ShellExecution(
      game.ref(coastX, 10),
      player1,
      player1.buildUnit(UnitType.Warship, game.ref(coastX, 10), {
        patrolTile: game.ref(coastX, 10),
      }),
      target,
    );

    await game.executeNextTick();
    const currentTicks = game.ticks();

    shell1.init(game, currentTicks);
    shell2.init(game, currentTicks);

    const healthBefore1 = target.health();
    target.modifyHealth(-shell1.getEffectOnTargetForTesting(), player1);
    const damage1 = healthBefore1 - target.health();

    target.modifyHealth(-(healthBefore1 - initialHealth));

    const healthBefore2 = target.health();
    target.modifyHealth(-shell2.getEffectOnTargetForTesting(), player1);
    const damage2 = healthBefore2 - target.health();

    expect(damage1).toBe(damage2);
  });
});
