import { GameUpdateType } from "src/core/game/GameUpdates";
import { vi, type Mocked } from "vitest";
import { DefaultConfig } from "../../../src/core/configuration/DefaultConfig";
import { TrainExecution } from "../../../src/core/execution/TrainExecution";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { Cluster, TrainStation } from "../../../src/core/game/TrainStation";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { TestServerConfig } from "../../util/TestServerConfig";

vi.mock("../../../src/core/game/Game");
vi.mock("../../../src/core/execution/TrainExecution");
vi.mock("../../../src/core/PseudoRandom");

describe("TrainStation", () => {
  let game: Mocked<Game>;
  let gameStats: {
    trainExternalTrade: ReturnType<typeof vi.fn>;
    trainSelfTrade: ReturnType<typeof vi.fn>;
  };
  let unit: Mocked<Unit>;
  let player: Mocked<Player>;
  let trainExecution: Mocked<TrainExecution>;

  beforeEach(() => {
    gameStats = {
      trainExternalTrade: vi.fn(),
      trainSelfTrade: vi.fn(),
    };
    game = {
      ticks: vi.fn().mockReturnValue(123),
      config: vi.fn().mockReturnValue({
        trainGold: (rel: string, _tradeStopsVisited: number) =>
          rel !== "other" ? BigInt(1000) : BigInt(500),
      }),
      addUpdate: vi.fn(),
      addExecution: vi.fn(),
      stats: vi.fn().mockReturnValue(gameStats),
    } as any;

    player = {
      addGold: vi.fn(),
      id: 1,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
      isFriendly: vi.fn().mockReturnValue(false),
    } as any;

    unit = {
      owner: vi.fn().mockReturnValue(player),
      level: vi.fn().mockReturnValue(1),
      tile: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      type: vi.fn(),
      isActive: vi.fn().mockReturnValue(true),
    } as any;

    trainExecution = {
      loadCargo: vi.fn(),
      owner: vi.fn().mockReturnValue(player),
      level: vi.fn(),
      tradeStopsVisited: vi.fn().mockReturnValue(0),
    } as any;
  });

  it("handles City stop", () => {
    unit.type.mockReturnValue(UnitType.City);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
  });

  it("handles allied trade", () => {
    unit.type.mockReturnValue(UnitType.City);
    player.isFriendly.mockReturnValue(true);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
    expect(trainExecution.owner().addGold).toHaveBeenCalledWith(
      1000n,
      unit.tile(),
    );
  });

  it("records external trade on the station owner", () => {
    const stationOwner = {
      addGold: vi.fn(),
      id: 1,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
    } as any;
    const trainOwner = {
      addGold: vi.fn(),
      id: 2,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
    } as any;

    unit.type.mockReturnValue(UnitType.City);
    unit.owner.mockReturnValue(stationOwner);
    trainExecution.owner.mockReturnValue(trainOwner);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(stationOwner.addGold).toHaveBeenCalledWith(500n, unit.tile());
    expect(trainOwner.addGold).toHaveBeenCalledWith(500n, unit.tile());
    expect(gameStats.trainExternalTrade).toHaveBeenCalledWith(
      stationOwner,
      500n,
    );
    expect(gameStats.trainSelfTrade).toHaveBeenCalledWith(trainOwner, 500n);
  });

  it("passes tradeStopsVisited to trainGold", () => {
    unit.type.mockReturnValue(UnitType.City);
    const trainGoldSpy = vi.fn().mockReturnValue(500n);
    (game.config as any).mockReturnValue({
      trainGold: trainGoldSpy,
    });
    (trainExecution as any).tradeStopsVisited = vi.fn().mockReturnValue(3);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(trainGoldSpy).toHaveBeenCalledWith(expect.any(String), 3);
  });

  it("checks trade availability (same owner)", () => {
    const otherUnit = {
      owner: vi.fn().mockReturnValue(unit.owner()),
    } as any;

    const station = new TrainStation(game, unit);
    const otherStation = new TrainStation(game, otherUnit);

    expect(station.tradeAvailable(otherStation.unit.owner())).toBe(true);
  });

  it("adds and retrieves neighbors", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);
    const railRoad = { from: stationA, to: stationB, tiles: [] } as any;

    stationA.addRailroad(railRoad);

    const neighbors = stationA.neighbors();
    expect(neighbors).toContain(stationB);
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

    stationA.removeNeighboringRails(stationB);

    expect(game.addUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: GameUpdateType.RailroadDestructionEvent,
      }),
    );
    expect(stationA.getRailroads().size).toBe(0);
  });

  it("assigns and retrieves cluster", () => {
    const cluster: Cluster = {} as Cluster;
    const station = new TrainStation(game, unit);

    station.setCluster(cluster);
    expect(station.getCluster()).toBe(cluster);
  });

  it("returns tile and active status", () => {
    const station = new TrainStation(game, unit);
    expect(station.tile()).toEqual({ x: 0, y: 0 });
    expect(station.isActive()).toBe(true);
  });
});

describe("DefaultConfig.trainGold trade stop penalty", () => {
  let config: DefaultConfig;

  beforeEach(() => {
    const serverConfig = new TestServerConfig();
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
    config = new DefaultConfig(
      serverConfig,
      gameConfig,
      new UserSettings(),
      false,
    );
  });

  it("returns full base gold within free window (stops 0-9)", () => {
    // first 10 stops (0-9) are free — no penalty
    expect(config.trainGold("self", 0)).toBe(10_000n);
    expect(config.trainGold("self", 9)).toBe(10_000n);
  });

  it("reduces gold by 5k per stop after the free window", () => {
    // stop 10: effective = 10-9 = 1 -> 10k - 5k = 5k
    expect(config.trainGold("self", 10)).toBe(5_000n);
  });

  it("floors at 5k when penalty exceeds base gold", () => {
    // stop 12: effective = 3 -> 10k - 15k -> floor at 5k
    expect(config.trainGold("self", 12)).toBe(5_000n);
  });

  it("floors at 5k for ally base even with heavy penalty", () => {
    // ally base 35k, stop 20: effective = 11 -> penalty 55k -> floor at 5k
    expect(config.trainGold("ally", 20)).toBe(5_000n);
  });

  it("ally base gold reduces correctly after free window", () => {
    // ally base 35k, stop 11: effective = 2 -> 35k - 10k = 25k
    expect(config.trainGold("ally", 11)).toBe(25_000n);
  });

  it("other/team base gold reduces correctly after free window", () => {
    // other base 25k, stop 10: effective = 1 -> 25k - 5k = 20k
    expect(config.trainGold("other", 10)).toBe(20_000n);
    expect(config.trainGold("team", 10)).toBe(20_000n);
  });
});
