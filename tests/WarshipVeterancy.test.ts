import { ShellExecution } from "../src/core/execution/ShellExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

const coastX = 7;
let game: Game;
let attacker: Player;
let defender: Player;

describe("Warship veterancy", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("attacker", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("defender", PlayerType.Human, null, "player_2_id"),
      ],
    );
    attacker = game.player("player_1_id");
    defender = game.player("player_2_id");
  });

  function buildWarship(player: Player, x: number, y: number): Unit {
    return player.buildUnit(UnitType.Warship, game.ref(x, y), {
      patrolTile: game.ref(x, y),
    });
  }

  test("killing an enemy warship grants one veterancy level", () => {
    const ship = buildWarship(attacker, coastX, 10);
    expect(ship.veterancy()).toBe(0);

    ship.recordKill(UnitType.Warship);

    expect(ship.veterancy()).toBe(1);
  });

  test("veterancy is capped at the configured maximum", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const max = game.config().warshipMaxVeterancy();

    for (let i = 0; i < max + 3; i++) {
      ship.recordKill(UnitType.Warship);
    }

    expect(ship.veterancy()).toBe(max);
  });

  test("destroying transport ships grants veterancy at the threshold", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const threshold = game.config().warshipVeterancyTransportKills();

    for (let i = 0; i < threshold - 1; i++) {
      ship.recordKill(UnitType.TransportShip);
    }
    expect(ship.veterancy()).toBe(0);

    ship.recordKill(UnitType.TransportShip);
    expect(ship.veterancy()).toBe(1);
  });

  test("capturing trade ships grants veterancy at the threshold", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const threshold = game.config().warshipVeterancyTradeCaptures();

    for (let i = 0; i < threshold - 1; i++) {
      ship.recordTradeCapture();
    }
    expect(ship.veterancy()).toBe(0);

    ship.recordTradeCapture();
    expect(ship.veterancy()).toBe(1);
  });

  test("veterancy raises max health but does not instantly heal", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const base = game.config().unitInfo(UnitType.Warship).maxHealth!;
    const bonusPercent = game.config().warshipVeterancyHealthBonus();

    // Drop below full so a (removed) instant heal would be observable.
    ship.modifyHealth(-100);
    expect(ship.maxHealth()).toBe(base);
    expect(ship.health()).toBe(base - 100);

    ship.recordKill(UnitType.Warship); // veterancy 1

    // The cap rises, but current health is unchanged — the ship heals toward
    // the new max normally, it does not jump on level-up.
    expect(ship.maxHealth()).toBe(
      base + Math.floor((base * 1 * bonusPercent) / 100),
    );
    expect(ship.health()).toBe(base - 100);
  });

  test("non-warships never gain veterancy", () => {
    const transport = defender.buildUnit(
      UnitType.TransportShip,
      game.ref(coastX, 10),
      {},
    );

    transport.recordKill(UnitType.Warship);
    transport.recordTradeCapture();

    expect(transport.veterancy()).toBe(0);
  });

  test("shell damage scales with the firing warship's veterancy", () => {
    const maxVet = game.config().warshipMaxVeterancy();
    const bonusPercent = game.config().warshipVeterancyShellDamageBonus();
    const target = buildWarship(defender, coastX + 5, 10);

    const baseShooter = buildWarship(attacker, coastX, 10);
    const vetShooter = buildWarship(attacker, coastX + 1, 10);
    for (let i = 0; i < maxVet; i++) {
      vetShooter.recordKill(UnitType.Warship);
    }
    expect(vetShooter.veterancy()).toBe(maxVet);

    const boostedValues = new Set<number>();
    for (let i = 0; i < 30; i++) {
      // Advance the tick so each pair of shells rolls a different seed.
      game.executeNextTick();

      const baseShell = new ShellExecution(
        baseShooter.tile(),
        attacker,
        baseShooter,
        target,
      );
      const vetShell = new ShellExecution(
        vetShooter.tile(),
        attacker,
        vetShooter,
        target,
      );
      baseShell.init(game, game.ticks());
      vetShell.init(game, game.ticks());

      const dBase = baseShell.getEffectOnTargetForTesting();
      const dVet = vetShell.getEffectOnTargetForTesting();

      // Same seed → same roll. Base damage is 250, so dBase equals the rolled
      // multiplier and the veteran's shot is the integer-boosted value.
      expect(dVet).toBe(
        Math.floor((dBase * (100 + maxVet * bonusPercent)) / 100),
      );
      boostedValues.add(dVet);
    }

    // The roll varied across ticks (not a constant).
    expect(boostedValues.size).toBeGreaterThan(1);
  });

  test("a shell landing the killing blow awards veterancy to the firing warship", () => {
    const shooter = buildWarship(attacker, coastX, 10);
    const target = buildWarship(defender, coastX + 1, 10);

    // Leave the target on its last sliver of health so any shell finishes it.
    target.modifyHealth(-(target.health() - 1));
    expect(target.health()).toBe(1);

    game.addExecution(
      new ShellExecution(shooter.tile(), attacker, shooter, target),
    );
    for (let i = 0; i < 30 && target.isActive(); i++) {
      game.executeNextTick();
    }

    expect(target.isActive()).toBe(false);
    expect(shooter.veterancy()).toBe(1);
  });
});
