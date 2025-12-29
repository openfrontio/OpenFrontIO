import { TrainExecution } from "../../../src/core/execution/TrainExecution";
import { Game, Player, Unit, UnitType } from "../../../src/core/game/Game";
import { Cluster, TrainStation } from "../../../src/core/game/TrainStation";

jest.mock("../../../src/core/game/Game");
jest.mock("../../../src/core/execution/TrainExecution");
jest.mock("../../../src/core/PseudoRandom");

describe("TrainStation", () => {
  let game: jest.Mocked<Game>;
  let unit: jest.Mocked<Unit>;
  let player: jest.Mocked<Player>;
  let trainExecution: jest.Mocked<TrainExecution>;

  beforeEach(() => {
    game = {
      ticks: jest.fn().mockReturnValue(123),
      config: jest.fn().mockReturnValue({
        trainGold: (rel: string) => {
          switch (rel) {
            case "self":
              return 1000n;
            case "ally":
              return 800n;
            case "team":
              return 700n;
            default:
              return 500n;
          }
        },
      }),
      addUpdate: jest.fn(),
      addExecution: jest.fn(),
      owner: jest.fn(),
    } as any;

    player = {
      addGold: jest.fn(),
      id: 1,
      canTrade: jest.fn().mockReturnValue(true),
      isFriendly: jest.fn().mockReturnValue(false),
      isAlliedWith: jest.fn().mockReturnValue(false),
      isOnSameTeam: jest.fn().mockReturnValue(false),
    } as any;

    unit = {
      owner: jest.fn().mockReturnValue(player),
      level: jest.fn().mockReturnValue(1),
      tile: jest.fn().mockReturnValue({ x: 0, y: 0 }),
      type: jest.fn(),
      isActive: jest.fn().mockReturnValue(true),
    } as any;

    trainExecution = {
      loadCargo: jest.fn(),
      owner: jest.fn().mockReturnValue(player),
      level: jest.fn(),
    } as any;

    game.owner.mockReturnValue(player);
  });

  it("handles City stop", () => {
    unit.type.mockReturnValue(UnitType.City);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
  });

  it("handles allied trade", () => {
    unit.type.mockReturnValue(UnitType.City);
    const ally: any = {
      addGold: jest.fn(),
      isAlliedWith: jest.fn().mockReturnValue(true),
      isOnSameTeam: jest.fn().mockReturnValue(false),
      isFriendly: jest.fn().mockReturnValue(true),
    };
    trainExecution.owner.mockReturnValue(ally);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(800n, unit.tile());
    expect(trainExecution.owner().addGold).toHaveBeenCalledWith(
      800n,
      unit.tile(),
    );
  });

  it("checks trade availability (same owner)", () => {
    const otherUnit = {
      owner: jest.fn().mockReturnValue(unit.owner()),
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
        isActive: false,
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

  it("pays tile owner when city built by another friendly on their land", () => {
    unit.type.mockReturnValue(UnitType.City);
    const stationOwner = player; // builder (overlord)
    const tileOwner: any = {
      addGold: jest.fn(),
      isPlayer: jest.fn().mockReturnValue(true),
      isFriendly: jest.fn().mockReturnValue(true),
      isAlliedWith: jest.fn().mockReturnValue(false),
      isOnSameTeam: jest.fn().mockReturnValue(false),
    };
    const trainOwner = stationOwner; // overlord runs the train
    trainExecution.owner.mockReturnValue(trainOwner as any);
    game.owner.mockReturnValue(tileOwner);
    stationOwner.isFriendly.mockReturnValue(true);
    stationOwner.isAlliedWith.mockReturnValue(true);

    const station = new TrainStation(game, unit);
    station.onTrainStop(trainExecution);

    // Effective owner is tileOwner (friendly land), so trainOwner gets ally rate
    expect(trainOwner.addGold).toHaveBeenCalledWith(800n, unit.tile());
    // tile owner also gets ally rate
    expect(tileOwner.addGold).toHaveBeenCalledWith(800n, unit.tile());
    // station owner is same as train owner; no extra payout
    expect(stationOwner.addGold).toHaveBeenCalledTimes(1);
  });

  it("pays tile owner for port on friendly land", () => {
    unit.type.mockReturnValue(UnitType.Port);
    const stationOwner = player; // builder
    const tileOwner: any = {
      addGold: jest.fn(),
      isPlayer: jest.fn().mockReturnValue(true),
      isFriendly: jest.fn().mockReturnValue(true),
      isAlliedWith: jest.fn().mockReturnValue(true),
      isOnSameTeam: jest.fn().mockReturnValue(false),
    };
    const trainOwner = stationOwner;
    trainExecution.owner.mockReturnValue(trainOwner as any);
    game.owner.mockReturnValue(tileOwner);
    stationOwner.isFriendly.mockReturnValue(true);
    stationOwner.isAlliedWith.mockReturnValue(true);

    const station = new TrainStation(game, unit);
    station.onTrainStop(trainExecution);

    // Effective owner is tile owner (friendly land), ally rate
    expect(trainOwner.addGold).toHaveBeenCalledWith(800n, unit.tile());
    expect(tileOwner.addGold).toHaveBeenCalledWith(800n, unit.tile());
  });
});
