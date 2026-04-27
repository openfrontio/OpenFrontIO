import { PortExecution } from "../src/core/execution/PortExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player: Player;
let other: Player;

describe("PortExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        instantBuild: true,
      },
      [
        new PlayerInfo("player", PlayerType.Human, null, "player_id"),
        new PlayerInfo("other", PlayerType.Human, null, "other_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player = game.player("player_id");
    player.addGold(BigInt(1000000));
    other = game.player("other_id");

    game.config().structureMinDist = () => 10;
  });

  test("Destination ports chances scale with level", () => {
    game.config().proximityBonusPortsNb = () => 0;
    game.config().tradeShipShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Port, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Port, spawn, {});
    const execution = new PortExecution(port);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    const otherPort = other.buildUnit(UnitType.Port, game.ref(0, 0), {});
    otherPort.increaseLevel();
    otherPort.increaseLevel();

    const ports = execution.tradingPorts();

    expect(ports.length).toBe(3);
  });

  test("Trade ship proximity bonus", () => {
    game.config().proximityBonusPortsNb = () => 10;
    game.config().tradeShipShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Port, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Port, spawn, {});
    const execution = new PortExecution(port);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    other.buildUnit(UnitType.Port, game.ref(0, 0), {});

    const ports = execution.tradingPorts();

    expect(ports.length).toBe(2);
  });

  test("Trade ship short range debuff", () => {
    game.config().proximityBonusPortsNb = () => 10;
    // Short range debuff cancels out the proximity bonus.
    game.config().tradeShipShortRangeDebuff = () => 100;

    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Port, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Port, spawn, {});
    const execution = new PortExecution(port);
    execution.init(game, 0);
    execution.tick(0);

    other.conquer(game.ref(0, 0));
    other.buildUnit(UnitType.Port, game.ref(0, 0), {});

    const ports = execution.tradingPorts();

    expect(ports.length).toBe(1);
  });

  test("Self-trade: own ports appear as destinations", () => {
    game.config().proximityBonusPortsNb = () => 0;
    game.config().tradeShipShortRangeDebuff = () => 0;
    game.config().structureMinDist = () => 0;

    player.conquer(game.ref(7, 5));
    player.conquer(game.ref(7, 15));
    const spawn1 = player.canBuild(UnitType.Port, game.ref(7, 5));
    const spawn2 = player.canBuild(UnitType.Port, game.ref(7, 15));
    if (spawn1 === false || spawn2 === false) {
      throw new Error("Unable to build ports for test");
    }
    const port1 = player.buildUnit(UnitType.Port, spawn1, {});
    player.buildUnit(UnitType.Port, spawn2, {});

    const execution = new PortExecution(port1);
    execution.init(game, 0);
    execution.tick(0);

    const ports = execution.tradingPorts();

    // Should include the player's other port
    expect(ports.length).toBeGreaterThanOrEqual(1);
    expect(ports.some((p) => p.owner() === player)).toBe(true);
  });

  test("Self-trade: port does not trade with itself", () => {
    game.config().proximityBonusPortsNb = () => 0;
    game.config().tradeShipShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Port, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Port, spawn, {});

    const execution = new PortExecution(port);
    execution.init(game, 0);
    execution.tick(0);

    const ports = execution.tradingPorts();

    // With only one own port and no other player ports, no destinations available
    expect(ports.length).toBe(0);
  });

  test("Self-trade: own ports do not get proximity or friendly bonuses", () => {
    game.config().proximityBonusPortsNb = () => 10;
    game.config().tradeShipShortRangeDebuff = () => 0;
    game.config().structureMinDist = () => 0;

    player.conquer(game.ref(7, 5));
    player.conquer(game.ref(7, 15));
    const spawn1 = player.canBuild(UnitType.Port, game.ref(7, 5));
    const spawn2 = player.canBuild(UnitType.Port, game.ref(7, 15));
    if (spawn1 === false || spawn2 === false) {
      throw new Error("Unable to build ports for test");
    }
    const port1 = player.buildUnit(UnitType.Port, spawn1, {});
    player.buildUnit(UnitType.Port, spawn2, {});

    const execution = new PortExecution(port1);
    execution.init(game, 0);
    execution.tick(0);

    const ports = execution.tradingPorts();

    // Own port at level 1 should appear once (base weight only, no bonuses)
    expect(ports.length).toBe(1);
  });
});
