import { TrainExecution } from "../../../src/core/execution/TrainExecution";
import { Game, Unit, UnitType } from "../../../src/core/game/Game";
import { Cluster, TrainStation } from "../../../src/core/game/TrainStation";

jest.mock("../../../src/core/game/Game");
jest.mock("../../../src/core/execution/TrainExecution");
jest.mock("../../../src/core/PseudoRandom");

describe("TrainStation", () => {
  let game: jest.Mocked<Game>;
  let unit: jest.Mocked<Unit>;
  let trainExecution: jest.Mocked<TrainExecution>;

  beforeEach(() => {
    game = {
      ticks: jest.fn().mockReturnValue(123),
      config: jest.fn().mockReturnValue({
        trainGold: () => 10,
      }),
      addUpdate: jest.fn(),
      addExecution: jest.fn(),
    } as any;

    unit = {
      owner: jest.fn().mockReturnValue({
        addGold: jest.fn(),
        id: 1,
        canTrade: jest.fn().mockReturnValue(true),
        tradingPorts: jest.fn().mockReturnValue([{ name: "Port1" }]),
      }),
      tile: jest.fn().mockReturnValue({ x: 0, y: 0 }),
      type: jest.fn(),
      isActive: jest.fn().mockReturnValue(true),
    } as any;

    trainExecution = {
      loadCargo: jest.fn(),
    } as any;
  });

  it("handles City stop", () => {
    unit.type.mockReturnValue(UnitType.City);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(10, unit.tile());
  });

  it("handles Port stop", () => {
    unit.type.mockReturnValue(UnitType.Port);

    const station = new TrainStation(game, unit);
    station.onTrainStop(trainExecution);

    expect(game.addExecution).toHaveBeenCalled();
  });

  it("handles Factory stop", () => {
    unit.type.mockReturnValue(UnitType.Factory);

    const station = new TrainStation(game, unit);
    station.onTrainStop(trainExecution);

    expect(trainExecution.loadCargo).toHaveBeenCalled();
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
});
