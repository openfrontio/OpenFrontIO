import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  PortExecution,
  WeightedPort,
} from "@openfront/engine/execution/PortExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

const totalWeight = (ports: WeightedPort[]) =>
  ports.reduce((sum, p) => sum + p.weight, 0);

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

    expect(totalWeight(ports)).toBe(3);
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

    expect(totalWeight(ports)).toBe(2);
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

    expect(totalWeight(ports)).toBe(1);
  });

  test("Very high level ports are weighted without expanding a list", () => {
    game.config().proximityBonusPortsNb = () => 10;
    game.config().tradeShipShortRangeDebuff = () => 0;

    player.conquer(game.ref(7, 10));
    const port = player.buildUnit(UnitType.Port, game.ref(7, 10), {});
    const execution = new PortExecution(port);
    execution.init(game, 0);

    other.conquer(game.ref(0, 0));
    const otherPort = other.buildUnit(UnitType.Port, game.ref(0, 0), {});
    vi.spyOn(otherPort, "level").mockReturnValue(1_000_000);

    const ports = execution.tradingPorts();
    expect(ports).toEqual([{ port: otherPort, weight: 2_000_000 }]);
    expect(execution.pickTradingPort(ports)).toBe(otherPort);
  });

  test("pickTradingPort honours weights and skips empty lists", () => {
    player.conquer(game.ref(7, 10));
    const port = player.buildUnit(UnitType.Port, game.ref(7, 10), {});
    const execution = new PortExecution(port);
    execution.init(game, 0);

    expect(execution.pickTradingPort([])).toBeNull();

    other.conquer(game.ref(0, 0));
    const a = other.buildUnit(UnitType.Port, game.ref(0, 0), {});
    const picks = new Set<unknown>();
    for (let i = 0; i < 50; i++) {
      picks.add(
        execution.pickTradingPort([
          { port: a, weight: 0 },
          { port, weight: 5 },
        ]),
      );
    }
    expect([...picks]).toEqual([port]);
  });

  test("shouldSpawnTradeShip recomputes spawn rate per level with updated rejection count", () => {
    player.conquer(game.ref(7, 10));
    const port = player.buildUnit(UnitType.Port, game.ref(7, 10), {});
    port.increaseLevel(); // level 2
    const execution = new PortExecution(port);
    execution.init(game, 0);

    const rejections: number[] = [];
    game.config().tradeShipSpawnRate = (r) => (rejections.push(r), 1000000);
    expect(execution.shouldSpawnTradeShip()).toBe(false);
    expect(rejections).toEqual([0, 1]);

    game.config().tradeShipSpawnRate = (r) => (rejections.push(r), 1);
    expect(execution.shouldSpawnTradeShip()).toBe(true);
    expect(rejections).toEqual([0, 1, 2]);

    game.config().tradeShipSpawnRate = (r) => (rejections.push(r), 1000000);
    expect(execution.shouldSpawnTradeShip()).toBe(false);
    expect(rejections).toEqual([0, 1, 2, 0, 1]);
  });
});
