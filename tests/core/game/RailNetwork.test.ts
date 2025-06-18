import { Unit } from "../../../src/core/game/Game";
import {
  RailConnectorImpl,
  RailNetworkImpl,
  StationManagerImpl,
} from "../../../src/core/game/RailNetworkImpl";
import { Cluster } from "../../../src/core/game/TrainStation";

// Mock types
const createMockStation = (unitId: number): any => {
  const cluster = new Cluster();
  return {
    unit: { id: unitId },
    tile: jest.fn(),
    neighbors: jest.fn(() => []),
    getCluster: jest.fn(() => cluster),
    setCluster: jest.fn(),
    addRailRoad: jest.fn(),
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
    expect(manager.findStation(station.unit)).toBe(null);
  });
});

describe("RailConnectorImpl", () => {
  let game: any;
  let pathService: any;
  let connector: RailConnectorImpl;

  beforeEach(() => {
    game = {
      config: () => ({ railroadMaxSize: () => 100 }),
      addExecution: jest.fn(),
    };
    pathService = { findTilePath: jest.fn() };
    connector = new RailConnectorImpl(game, pathService);
  });

  test("connects stations when path is valid", () => {
    const stationA = createMockStation(1);
    const stationB = createMockStation(2);
    pathService.findTilePath.mockReturnValue(new Array(10));

    const result = connector.connect(stationA, stationB);
    expect(result).toBe(true);
    expect(game.addExecution).toHaveBeenCalled();
  });

  test("does not connect if path is empty or too long", () => {
    const stationA = createMockStation(1);
    const stationB = createMockStation(2);

    pathService.findTilePath.mockReturnValue([]);
    expect(connector.connect(stationA, stationB)).toBe(false);

    pathService.findTilePath.mockReturnValue(new Array(200));
    expect(connector.connect(stationA, stationB)).toBe(false);
  });

  test("disconnect removes all neighbor links", () => {
    const neighbor = { removeNeighboringRails: jest.fn() };
    const station = createMockStation(1);
    station.neighbors = jest.fn(() => [neighbor]);

    connector.disconnect(station);
    expect(neighbor.removeNeighboringRails).toHaveBeenCalledWith(station);
  });
});

describe("RailNetworkImpl", () => {
  let network: RailNetworkImpl;
  let stationManager: any;
  let pathService: any;
  let railConnector: any;
  let game: any;

  beforeEach(() => {
    stationManager = {
      addStation: jest.fn(),
      removeStation: jest.fn(),
      findStation: jest.fn(),
      getAll: jest.fn(() => new Set()),
    };
    railConnector = {
      connect: jest.fn(() => true),
      disconnect: jest.fn(),
    };
    pathService = {
      findStationPath: jest.fn(() => [0]),
    };
    game = {
      nearbyUnits: jest.fn(() => []),
      config: () => ({
        trainStationMaxRange: () => 80,
        trainStationMinRange: () => 10,
      }),
    };

    network = new RailNetworkImpl(
      game,
      stationManager,
      railConnector,
      pathService,
    );
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
    expect(railConnector.disconnect).not.toHaveBeenCalled();
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
    expect(railConnector.disconnect).toHaveBeenCalledWith(station);
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

    const neighborUnit = { unit: neighborStation.unit, distSquared: 20 };

    game.nearbyUnits.mockReturnValue([neighborUnit]);
    stationManager.findStation.mockReturnValue(neighborStation);

    network.connectStation(station);
    expect(railConnector.connect).toHaveBeenCalledWith(
      station,
      neighborStation,
    );
  });
});
