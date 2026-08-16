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
    game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, null, "player_id"),
      new PlayerInfo("other", PlayerType.Human, null, "other_id"),
    ]);

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

  test("shouldSpawnTradeShip recomputes spawn rate per level with updated rejection count", () => {
    player.conquer(game.ref(7, 10));
    const spawn = player.canBuild(UnitType.Port, game.ref(7, 10));
    if (spawn === false) {
      throw new Error("Unable to build port for test");
    }
    const port = player.buildUnit(UnitType.Port, spawn, {});
    port.increaseLevel();
    port.increaseLevel(); // level is 3

    const execution = new PortExecution(port);
    execution.init(game, 0);

    const rejectionsReceived: number[] = [];
    game.config().tradeShipSpawnRate = (
      rejections: number,
      numTradeShips: number,
    ) => {
      rejectionsReceived.push(rejections);
      return 1000000;
    };

    const spawned = execution.shouldSpawnTradeShip();
    expect(spawned).toBe(false);
    // For a level 3 port, 3 failed rolls query spawn rate with rejections 0, 1, 2
    expect(rejectionsReceived).toEqual([0, 1, 2]);

    // Next call should start from 3
    rejectionsReceived.length = 0;
    execution.shouldSpawnTradeShip();
    expect(rejectionsReceived).toEqual([3, 4, 5]);

    // If a roll succeeds (spawnRate = 1 guarantees success)
    game.config().tradeShipSpawnRate = (
      rejections: number,
      numTradeShips: number,
    ) => {
      rejectionsReceived.push(rejections);
      return 1;
    };
    rejectionsReceived.length = 0;
    const success = execution.shouldSpawnTradeShip();
    expect(success).toBe(true);
    expect(rejectionsReceived).toEqual([6]);

    // Rejections are reset to 0 after success
    game.config().tradeShipSpawnRate = (
      rejections: number,
      numTradeShips: number,
    ) => {
      rejectionsReceived.push(rejections);
      return 1000000;
    };
    rejectionsReceived.length = 0;
    execution.shouldSpawnTradeShip();
    expect(rejectionsReceived).toEqual([0, 1, 2]);
  });
});
