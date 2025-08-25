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
      addExecution: jest.fn(),
      addUpdate: jest.fn(),
      config: jest.fn().mockReturnValue({
        trainGold: (isFriendly: boolean) =>
          isFriendly ? BigInt(1000) : BigInt(500),
      }),
      ticks: jest.fn().mockReturnValue(123),
    } as any;

    player = {
      addGold: jest.fn(),
      canTrade: jest.fn().mockReturnValue(true),
      id: 1,
      isFriendly: jest.fn().mockReturnValue(false),
    } as any;

    unit = {
      isActive: jest.fn().mockReturnValue(true),
      level: jest.fn().mockReturnValue(1),
      owner: jest.fn().mockReturnValue(player),
      tile: jest.fn().mockReturnValue({ x: 0, y: 0 }),
      type: jest.fn(),
    } as any;

    trainExecution = {
      level: jest.fn(),
      loadCargo: jest.fn(),
      owner: jest.fn().mockReturnValue(player),
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

    expect(unit.owner().addGold).toHaveBeenCalledWith(2000n, unit.tile());
    expect(trainExecution.owner().addGold).toHaveBeenCalledWith(
      2000n,
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
    const railRoad = { from: stationA, tiles: [], to: stationB } as any;

    stationA.addRailroad(railRoad);

    const neighbors = stationA.neighbors();
    expect(neighbors).toContain(stationB);
  });

  it("removes neighboring rail", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);

    const railRoad = {
      from: stationA,
      tiles: [{ x: 1, y: 1 }],
      to: stationB,
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
});
