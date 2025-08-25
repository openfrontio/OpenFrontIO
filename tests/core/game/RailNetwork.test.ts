import { Unit } from "../../../src/core/game/Game";
import {
  RailNetworkImpl,
  StationManagerImpl,
} from "../../../src/core/game/RailNetworkImpl";
import { Railroad } from "../../../src/core/game/Railroad";
import { Cluster } from "../../../src/core/game/TrainStation";

// Mock types
const createMockStation = (unitId: number): any => {
  const cluster = new Cluster();
  const railroads = new Set<Railroad>();
  return {
    addRailroad: jest.fn(),
    clearRailroads: jest.fn(),
    getCluster: jest.fn(() => cluster),
    getRailroads: jest.fn(() => railroads),
    neighbors: jest.fn(() => []),
    setCluster: jest.fn(),
    tile: jest.fn(),
    unit: {
      id: unitId,
      setTrainStation: jest.fn(),
    },
  };
};

describe("StationManagerImpl", () => {
  let manager: StationManagerImpl;

  beforeEach(() => {
    manager = new StationManagerImpl();
  });

  test("adds and retrieves station", () => {
    const station = createMockStation(1);
    manager.addStation(station);
    expect(manager.findStation(station.unit)).toBe(station);
  });

  test("removes station", () => {
    const station = createMockStation(1);
    manager.addStation(station);
    manager.removeStation(station);
    expect(manager.findStation(station.unit)).toBeNull();
  });
});

describe("RailNetworkImpl", () => {
  let network: RailNetworkImpl;
  let stationManager: any;
  let pathService: any;
  let game: any;

  beforeEach(() => {
    stationManager = {
      addStation: jest.fn(),
      findStation: jest.fn(),
      getAll: jest.fn(() => new Set()),
      removeStation: jest.fn(),
    };
    pathService = {
      findStationsPath: jest.fn(() => [0]),
      findTilePath: jest.fn(() => [0]),
    };
    game = {
      addExecution: jest.fn(),
      config: () => ({
        railroadMaxSize: () => 100,
        trainStationMaxRange: () => 80,
        trainStationMinRange: () => 10,
      }),
      nearbyUnits: jest.fn(() => []),
    };

    network = new RailNetworkImpl(game, stationManager, pathService);
  });

  test("does not connect if path is empty or too long", () => {
    const stationA = createMockStation(1);
    const stationB = createMockStation(2);

    game.nearbyUnits.mockReturnValue([stationB]);

    pathService.findTilePath.mockReturnValue([]);
    network.connectStation(stationA);

    const cluster = stationB.getCluster();
    cluster.addStation = jest.fn();
    expect(cluster.addStation).not.toHaveBeenCalled();

    pathService.findTilePath.mockReturnValue(new Array(200));
    network.connectStation(stationA);
    expect(cluster.addStation).not.toHaveBeenCalled();
  });

  test("removeStation removes all neighbor links", () => {
    const neighbor = { removeNeighboringRails: jest.fn() };
    const station = createMockStation(1);
    station.neighbors = jest.fn(() => [neighbor]);
    stationManager.findStation.mockReturnValue(station);
    network.removeStation(station);
    expect(station.clearRailroads).toHaveBeenCalled();
  });

  test("connectStation calls addStation and connects to nearby", () => {
    const station = createMockStation(1);
    network.connectStation(station);
    expect(stationManager.addStation).toHaveBeenCalledWith(station);
  });

  test("removeStation does nothing if station not found", () => {
    stationManager.findStation.mockReturnValue(null);
    network.removeStation({ id: 1 } as unknown as Unit);
    expect(stationManager.removeStation).not.toHaveBeenCalled();
  });

  test("removeStation disconnects and removes from cluster if one neighbor", () => {
    const cluster = new Cluster();
    const neighbor = createMockStation(1);
    const station = createMockStation(2);
    station.getCluster = jest.fn(() => cluster);
    station.neighbors = jest.fn(() => [neighbor]);
    cluster.removeStation = jest.fn();

    stationManager.findStation.mockReturnValue(station);

    network.removeStation(station.unit);
    expect(cluster.removeStation).toHaveBeenCalledWith(station);
    expect(stationManager.removeStation).toHaveBeenCalledWith(station);
  });

  test("findStationsPath", () => {
    const stationA = createMockStation(1);
    const stationB = createMockStation(2);
    const result = network.findStationsPath(stationA, stationB);
    expect(result).toEqual([0]);
  });

  test("connectToNearbyStations creates new cluster when no neighbors", () => {
    const station = createMockStation(1);
    game.nearbyUnits.mockReturnValue([]);
    network.connectStation(station);
    expect(stationManager.addStation).toHaveBeenCalledWith(station);
    expect(station.setCluster).toHaveBeenCalled();
  });

  test("connectToNearbyStations connects and merges clusters", () => {
    const station = createMockStation(1);
    const neighborStation = createMockStation(2);
    const cluster = new Cluster();
    cluster.addStation(neighborStation);
    neighborStation.getCluster = jest.fn(() => cluster);
    cluster.has = jest.fn(() => false);

    const neighborUnit = { distSquared: 20, unit: neighborStation.unit };

    game.nearbyUnits.mockReturnValue([neighborUnit]);
    stationManager.findStation.mockReturnValue(neighborStation);

    network.connectStation(station);
    // Both station should have their cluster reset to the merged one
    expect(station.setCluster).toHaveBeenCalled();
    expect(neighborStation.setCluster).toHaveBeenCalled();
  });
});
