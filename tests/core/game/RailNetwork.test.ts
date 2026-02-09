import { Unit, UnitType } from "../../../src/core/game/Game";
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
    unit: {
      id: unitId,
      setTrainStation: vi.fn(),
      type: vi.fn(() => UnitType.City),
    },
    tile: vi.fn(),
    neighbors: vi.fn(() => []),
    getCluster: vi.fn(() => cluster),
    setCluster: vi.fn(),
    addRailroad: vi.fn(),
    getRailroads: vi.fn(() => railroads),
    clearRailroads: vi.fn(),
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

describe("RailNetworkImpl", () => {
  let network: RailNetworkImpl;
  let stationManager: any;
  let pathService: any;
  let game: any;

  beforeEach(() => {
    stationManager = {
      addStation: vi.fn(),
      removeStation: vi.fn(),
      findStation: vi.fn(),
      getAll: vi.fn(() => new Set()),
    };
    pathService = {
      findTilePath: vi.fn(() => [0]),
      findStationsPath: vi.fn(() => [0]),
    };
    game = {
      nearbyUnits: vi.fn(() => []),
      addExecution: vi.fn(),
      config: () => ({
        trainStationMaxRange: () => 80,
        trainStationMinRange: () => 10,
        railroadMaxSize: () => 100,
      }),
      x: vi.fn(() => 0),
      y: vi.fn(() => 0),
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
    cluster.addStation = vi.fn();
    expect(cluster.addStation).not.toHaveBeenCalled();

    pathService.findTilePath.mockReturnValue(new Array(200));
    network.connectStation(stationA);
    expect(cluster.addStation).not.toHaveBeenCalled();
  });

  test("removeStation removes all neighbor links", () => {
    const neighbor = { removeNeighboringRails: vi.fn() };
    const station = createMockStation(1);
    station.neighbors = vi.fn(() => [neighbor]);
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
    station.getCluster = vi.fn(() => cluster);
    station.neighbors = vi.fn(() => [neighbor]);
    cluster.removeStation = vi.fn();

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
    neighborStation.getCluster = vi.fn(() => cluster);
    cluster.has = vi.fn(() => false);

    const neighborUnit = { unit: neighborStation.unit, distSquared: 20 };

    game.nearbyUnits.mockReturnValue([neighborUnit]);
    stationManager.findStation.mockReturnValue(neighborStation);

    network.connectStation(station);
    // Both station should have their cluster reset to the merged one
    expect(station.setCluster).toHaveBeenCalled();
    expect(neighborStation.setCluster).toHaveBeenCalled();
  });
});
