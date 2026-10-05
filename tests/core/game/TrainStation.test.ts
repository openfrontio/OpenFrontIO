import { GameUpdateType } from "src/core/game/GameUpdates";
import { vi } from "vitest";
import { Config } from "../../../src/core/configuration/Config";
import { TrainExecution } from "../../../src/core/execution/TrainExecution";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { Cluster, TrainStation } from "../../../src/core/game/TrainStation";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { playerInfo, setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";

class WiringTestConfig extends TestConfig {
  factoryStackMultiplier(level: number) {
    return level;
  }
  stationStackMultiplier(level: number) {
    return level;
  }
}

describe("TrainStation", () => {
  let game: Game;
  let unit: Unit;
  let player: Player;
  let trainExecution: TrainExecution;

  beforeEach(async () => {
    game = await setup(
      "plains",
      {},
      [
        playerInfo("one", PlayerType.Human),
        playerInfo("two", PlayerType.Human),
      ],
      undefined,
      WiringTestConfig,
    );

    player = game.player("one")!;
    const tile = game.ref(5, 5);
    unit = player.buildUnit(UnitType.City, tile, {});

    const destTile = game.ref(10, 10);
    const destUnit = player.buildUnit(UnitType.City, destTile, {});

    const sourceStation = new TrainStation(game, unit);
    const destStation = new TrainStation(game, destUnit);
    trainExecution = new TrainExecution(
      game.railNetwork(),
      player,
      sourceStation,
      destStation,
      1,
    );
  });

  it("handles City stop", () => {
    const station = new TrainStation(game, unit);
    const goldBefore = player.gold();

    station.onTrainStop(trainExecution);

    // baseGold for self is 10_000n. Stack multiplier is 1 * 1 = 1.
    expect(player.gold() - goldBefore).toBe(10_000n);
  });

  it("handles allied trade", () => {
    const ally = game.player("two")!;
    vi.spyOn(player, "isFriendly").mockReturnValue(true);
    vi.spyOn(player, "isAlliedWith").mockReturnValue(true);

    vi.spyOn(unit, "owner").mockReturnValue(ally);

    const station = new TrainStation(game, unit);
    const allyGoldBefore = ally.gold();
    const playerGoldBefore = player.gold();

    station.onTrainStop(trainExecution);

    // baseGold for ally is 35_000n.
    expect(ally.gold() - allyGoldBefore).toBe(35_000n);
    expect(player.gold() - playerGoldBefore).toBe(35_000n);
  });

  it("records external trade on the station owner", () => {
    const stationOwner = game.player("two")!;
    vi.spyOn(unit, "owner").mockReturnValue(stationOwner);

    const trainExternalTradeSpy = vi.spyOn(game.stats(), "trainExternalTrade");
    const trainSelfTradeSpy = vi.spyOn(game.stats(), "trainSelfTrade");

    const station = new TrainStation(game, unit);
    station.onTrainStop(trainExecution);

    // baseGold for other/team is 25_000n.
    expect(trainExternalTradeSpy).toHaveBeenCalledWith(stationOwner, 25_000n);
    expect(trainSelfTradeSpy).toHaveBeenCalledWith(player, 25_000n);
  });

  it("passes exact source and station levels through the simulation to trainGold", () => {
    // 1. Create a Level 2 Factory (Source)
    const factoryTile = game.ref(15, 15);
    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    factory.increaseLevel();
    expect(factory.level()).toBe(2);

    // 2. Create a Level 3 City (Destination)
    const cityTile = game.ref(25, 25);
    const city = player.buildUnit(UnitType.City, cityTile, {});
    city.increaseLevel();
    city.increaseLevel();
    expect(city.level()).toBe(3);

    // 3. Instantiate true TrainStations and TrainExecution
    const factoryStation = new TrainStation(game, factory);
    const cityStation = new TrainStation(game, city);

    const trainExec = new TrainExecution(
      game.railNetwork(),
      player,
      factoryStation,
      cityStation,
      1,
    );

    // 4. Trigger the stop and measure exact gold output
    const goldBefore = player.gold();
    cityStation.onTrainStop(trainExec);
    const goldEarned = player.gold() - goldBefore;

    // Wiring Verification: base 10k * factoryLevel(2) * cityLevel(3)
    expect(goldEarned).toBe(60_000n);
  });

  it("passes tradeStopsVisited to trainGold through distance penalty", () => {
    vi.spyOn(trainExecution, "tradeStopsVisited").mockReturnValue(10); // 10 cities visited = penalty of 5k (1 stop over free window)

    const station = new TrainStation(game, unit);
    const goldBefore = player.gold();

    station.onTrainStop(trainExecution);

    // baseGold 10k - 5k penalty = 5k.
    expect(player.gold() - goldBefore).toBe(5_000n);
  });

  it("checks trade availability (same owner)", () => {
    const station = new TrainStation(game, unit);
    const otherStation = new TrainStation(game, unit);
    expect(station.tradeAvailable(otherStation.unit.owner())).toBe(true);
  });

  it("adds and retrieves neighbors", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);
    const railRoad = { from: stationA, to: stationB, tiles: [] } as any;

    stationA.addRailroad(railRoad);

    expect(stationA.neighbors()).toContain(stationB);
  });

  it("removes neighboring rail", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);
    const railRoad = {
      from: stationA,
      to: stationB,
      tiles: [{ x: 1, y: 1 }],
    } as any;

    stationA.addRailroad(railRoad);
    expect(stationA.getRailroads().size).toBe(1);

    const addUpdateSpy = vi.spyOn(game, "addUpdate");
    stationA.removeNeighboringRails(stationB);

    expect(addUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: GameUpdateType.RailroadDestructionEvent,
      }),
    );
    expect(stationA.getRailroads().size).toBe(0);
  });

  it("assigns and retrieves cluster", () => {
    const cluster = {} as Cluster;
    const station = new TrainStation(game, unit);

    station.setCluster(cluster);
    expect(station.getCluster()).toBe(cluster);
  });

  it("returns tile and active status", () => {
    const station = new TrainStation(game, unit);
    expect(station.tile()).toEqual(unit.tile());
    expect(station.isActive()).toBe(true);
  });
});

describe("Config.trainGold trade stop penalty", () => {
  let config: Config;
  let mockPlayer: Player;

  beforeEach(() => {
    const gameConfig: GameConfig = {
      gameMap: GameMapType.Asia,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      nations: "default",
      donateGold: false,
      donateTroops: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      disableNavMesh: false,
      randomSpawn: false,
    };
    config = new Config(gameConfig, new UserSettings(), false);
    mockPlayer = { isLobbyCreator: () => false } as unknown as Player;
  });

  it("returns full base gold within free window (stops 0-9)", () => {
    expect(config.trainGold("self", 0, mockPlayer)).toBe(10_000n);
    expect(config.trainGold("self", 9, mockPlayer)).toBe(10_000n);
  });

  it("reduces gold by 5k per stop after the free window", () => {
    expect(config.trainGold("self", 10, mockPlayer)).toBe(5_000n);
  });

  it("floors at 5k when penalty exceeds base gold", () => {
    expect(config.trainGold("self", 12, mockPlayer)).toBe(5_000n);
  });

  it("floors at 5k for ally base even with heavy penalty", () => {
    expect(config.trainGold("ally", 20, mockPlayer)).toBe(5_000n);
  });

  it("ally base gold reduces correctly after free window", () => {
    expect(config.trainGold("ally", 11, mockPlayer)).toBe(25_000n);
  });

  it("other/team base gold reduces correctly after free window", () => {
    expect(config.trainGold("other", 10, mockPlayer)).toBe(20_000n);
    expect(config.trainGold("team", 10, mockPlayer)).toBe(20_000n);
  });
});
