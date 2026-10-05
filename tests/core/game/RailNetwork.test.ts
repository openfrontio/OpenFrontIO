import { FactoryExecution } from "../../../src/core/execution/FactoryExecution";
import { PortExecution } from "../../../src/core/execution/PortExecution";
import { PlayerType, Unit, UnitType } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import {
  RailNetworkImpl,
  StationManagerImpl,
} from "../../../src/core/game/RailNetworkImpl";
import { Railroad } from "../../../src/core/game/Railroad";
import { Cluster } from "../../../src/core/game/TrainStation";
import { playerInfo, setup } from "../../util/Setup";

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
      hasUnitNearby: vi.fn(() => true),
      nearbyUnits: vi.fn(() => []),
      addExecution: vi.fn(),
      config: () => ({
        trainStationMaxRange: () => 80,
        trainStationMinRange: () => 10,
        railroadMaxSize: () => 100,
      }),
      x: vi.fn((tile: number) => tile),
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

  describe("overlappingRailroads", () => {
    test("returns deterministic deduplicated TileRef array", () => {
      const tile = 42 as any;
      const railGridMock = {
        query: vi.fn(
          () => new Set([{ tiles: [50, 42, 60] }, { tiles: [60, 45, 42] }]),
        ),
      };
      (network as any).railGrid = railGridMock;

      const result = network.overlappingRailroads(UnitType.City, tile);

      expect(railGridMock.query).toHaveBeenCalledWith(tile, 3);
      expect(result).toEqual([42, 45, 50, 60]); // Deduplicated and sorted
    });

    test("returns empty array when no railroads overlap", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      const result = network.overlappingRailroads(UnitType.City, tile);

      expect(result).toEqual([]);
    });

    test.each([
      UnitType.MissileSilo,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
    ])(
      "returns empty array for %s which cannot snap to railroads",
      (unitType) => {
        const tile = 42 as any;
        const railGridMock = {
          query: vi.fn(() => new Set([{ tiles: [50, 42, 60] }])),
        };
        (network as any).railGrid = railGridMock;

        const result = network.overlappingRailroads(unitType, tile);

        expect(result).toEqual([]);
        expect(railGridMock.query).not.toHaveBeenCalled();
      },
    );
  });

  describe("computeGhostRailPaths", () => {
    test("returns empty when snappable rails exist nearby", () => {
      const tile = 42 as any;
      // Accessing private railGrid via any to set up mock
      const railGridMock = { query: vi.fn(() => new Set([{}])) };
      (network as any).railGrid = railGridMock;

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result).toEqual([]);
      expect(railGridMock.query).toHaveBeenCalledWith(tile, 3);
    });

    test("returns empty when no nearby stations found", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;
      game.nearbyUnits.mockReturnValue([]);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result).toEqual([]);
    });

    test("returns paths to nearby stations within range", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      const neighborStation = createMockStation(1);
      neighborStation.tile.mockReturnValue(100);
      stationManager.findStation.mockReturnValue(neighborStation);
      stationManager.getAll.mockReturnValue(new Set([neighborStation]));

      const mockPath = [42, 50, 60, 100];
      pathService.findTilePath.mockReturnValue(mockPath);

      game.nearbyUnits.mockReturnValue([
        { unit: neighborStation.unit, distSquared: 400 },
      ]);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result).toEqual([mockPath]);
      expect(pathService.findTilePath).toHaveBeenCalledWith(tile, 100);
    });

    test("skips neighbors within min range", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      const neighborStation = createMockStation(1);
      neighborStation.tile.mockReturnValue(43);
      stationManager.findStation.mockReturnValue(neighborStation);
      stationManager.getAll.mockReturnValue(new Set([neighborStation]));

      // distSquared = 50 <= minRange^2 (10^2 = 100)
      game.nearbyUnits.mockReturnValue([
        { unit: neighborStation.unit, distSquared: 50 },
      ]);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result).toEqual([]);
    });

    test("skips neighbors without train stations", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      stationManager.findStation.mockReturnValue(null);

      game.nearbyUnits.mockReturnValue([{ unit: { id: 1 }, distSquared: 400 }]);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result).toEqual([]);
    });

    test("skips paths that exceed max railroad size", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      const neighborStation = createMockStation(1);
      neighborStation.tile.mockReturnValue(100);
      stationManager.findStation.mockReturnValue(neighborStation);
      stationManager.getAll.mockReturnValue(new Set([neighborStation]));

      // Path length >= railroadMaxSize (100)
      pathService.findTilePath.mockReturnValue(new Array(100));

      game.nearbyUnits.mockReturnValue([
        { unit: neighborStation.unit, distSquared: 400 },
      ]);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result).toEqual([]);
    });

    test("returns every rail that placement would create", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      const neighbors: Array<{ unit: any; distSquared: number }> = [];
      const stations: any[] = [];
      for (let i = 0; i < 7; i++) {
        const station = createMockStation(i);
        station.tile.mockReturnValue(100 + i);
        stations.push(station);
        neighbors.push({ unit: station.unit, distSquared: 400 + i });
      }
      stationManager.getAll.mockReturnValue(new Set(stations));

      pathService.findTilePath.mockImplementation((_from: any, to: any) => [
        _from,
        to,
      ]);

      game.nearbyUnits.mockReturnValue(neighbors);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result.length).toBe(7);
    });

    test("skips stations reachable through already-connected stations", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      // Create two neighbor stations where B is reachable from A
      const stationA = createMockStation(1);
      stationA.tile.mockReturnValue(100);
      const stationB = createMockStation(2);
      stationB.tile.mockReturnValue(200);

      // Make A and B neighbors of each other (1 hop apart).
      const existingRail = new Railroad(stationA, stationB, [100, 150, 200], 1);
      stationA.getRailroads().add(existingRail);
      stationB.getRailroads().add(existingRail);
      stationManager.getAll.mockReturnValue(new Set([stationA, stationB]));

      stationManager.findStation.mockImplementation((unit: any) => {
        if (unit.id === 1) return stationA;
        if (unit.id === 2) return stationB;
        return null;
      });

      pathService.findTilePath.mockImplementation((_from: any, to: any) => [
        _from,
        to,
      ]);

      // Station A is closer, station B is farther
      game.nearbyUnits.mockReturnValue([
        { unit: stationA.unit, distSquared: 400 },
        { unit: stationB.unit, distSquared: 900 },
      ]);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      // Only station A should get a path; B is already reachable through A.
      expect(result.length).toBe(1);
      expect(pathService.findTilePath).toHaveBeenCalledTimes(1);
      expect(pathService.findTilePath).toHaveBeenCalledWith(tile, 100);
    });

    test("factory connects to nearby structures with no pre-existing factory", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      // No factory in range, and the nearby city is not a station yet.
      game.hasUnitNearby.mockReturnValue(false);
      stationManager.findStation.mockReturnValue(null);

      const cityUnit = {
        id: 1,
        tile: vi.fn(() => 100),
        type: vi.fn(() => UnitType.City),
      };
      game.nearbyUnits.mockReturnValue([{ unit: cityUnit, distSquared: 400 }]);

      const mockPath = [100, 60, 50, 42];
      pathService.findTilePath.mockReturnValue(mockPath);

      const result = network.computeGhostRailPaths(UnitType.Factory, tile);
      expect(result).toEqual([mockPath]);
      expect(pathService.findTilePath).toHaveBeenCalledWith(100, tile);
    });

    test("factory preserves path direction to a non-station port", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      game.hasUnitNearby.mockReturnValue(false);
      stationManager.findStation.mockReturnValue(null);

      const portUnit = {
        id: vi.fn(() => 1),
        tile: vi.fn(() => 100),
        type: vi.fn(() => UnitType.Port),
      };
      game.nearbyUnits.mockReturnValue([{ unit: portUnit, distSquared: 400 }]);

      const mockPath = [42, 50, 60, 100];
      pathService.findTilePath.mockReturnValue(mockPath);

      const result = network.computeGhostRailPaths(UnitType.Factory, tile);
      expect(result).toEqual([mockPath]);
      expect(pathService.findTilePath).toHaveBeenCalledWith(tile, 100);
    });

    test("city does not connect to non-station neighbors without a factory", () => {
      const tile = 42 as any;
      const railGridMock = { query: vi.fn(() => new Set()) };
      (network as any).railGrid = railGridMock;

      game.hasUnitNearby.mockReturnValue(false);

      const result = network.computeGhostRailPaths(UnitType.City, tile);
      expect(result).toEqual([]);
    });
  });
});

function expectSameRailGeometry(
  previewPath: TileRef[],
  actualPath: TileRef[],
): void {
  const sameGeometry =
    previewPath.length === actualPath.length &&
    (previewPath.every((tile, index) => tile === actualPath[index]) ||
      previewPath.every(
        (tile, index) => tile === actualPath[actualPath.length - 1 - index],
      ));
  expect(sameGeometry).toBe(true);
}

function canonicalRailGeometry(path: TileRef[]): string {
  const forward = path.join(",");
  const reverse = [...path].reverse().join(",");
  return forward < reverse ? forward : reverse;
}

function allRailGeometries(game: Awaited<ReturnType<typeof setup>>): string[] {
  const railroads = new Set<Railroad>();
  for (const station of game.railNetwork().stationManager().getAll()) {
    for (const railroad of station.getRailroads()) railroads.add(railroad);
  }
  return Array.from(railroads, (railroad) =>
    canonicalRailGeometry(railroad.tiles),
  ).sort();
}

function previewGeometries(paths: TileRef[][]): string[] {
  return paths.map(canonicalRailGeometry).sort();
}

describe("factory rail preview path consistency", () => {
  test("matches the railway created for a promoted non-station city", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;

    const cityTile = game.ref(5, 5);
    const factoryTile = game.ref(25, 25);
    const city = player.buildUnit(UnitType.City, cityTile, {});

    expect(city.hasTrainStation()).toBe(false);
    const previewPath = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile)[0];
    expect(previewPath).toBeDefined();

    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    game.addExecution(new FactoryExecution(factory));
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    const manager = game.railNetwork().stationManager();
    const cityStation = manager.findStation(city);
    const factoryStation = manager.findStation(factory);
    expect(cityStation).not.toBeNull();
    expect(factoryStation).not.toBeNull();

    const railroad = cityStation!.getRailroadTo(factoryStation!);
    expect(railroad).not.toBeNull();
    expectSameRailGeometry(previewPath, railroad!.tiles);
  });

  test("matches the railway created for a pre-existing port", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;

    const portTile = game.ref(5, 5);
    const factoryTile = game.ref(25, 25);
    const port = player.buildUnit(UnitType.Port, portTile, {});
    game.addExecution(new PortExecution(port));
    game.executeNextTick();
    game.executeNextTick();

    expect(port.hasTrainStation()).toBe(false);
    const previewPath = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile)[0];
    expect(previewPath).toBeDefined();

    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    game.addExecution(new FactoryExecution(factory));
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
    }

    const manager = game.railNetwork().stationManager();
    const portStation = manager.findStation(port);
    const factoryStation = manager.findStation(factory);
    expect(portStation).not.toBeNull();
    expect(factoryStation).not.toBeNull();

    const railroad = factoryStation!.getRailroadTo(portStation!);
    expect(railroad).not.toBeNull();
    expectSameRailGeometry(previewPath, railroad!.tiles);
  });

  test("matches optimized placement for two non-collinear cities", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;
    const city1 = player.buildUnit(UnitType.City, game.ref(5, 5), {});
    const city2 = player.buildUnit(UnitType.City, game.ref(5, 25), {});
    const factoryTile = game.ref(25, 15);

    const preview = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile);
    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    game.addExecution(new FactoryExecution(factory));
    for (let i = 0; i < 5; i++) game.executeNextTick();

    expect(previewGeometries(preview)).toEqual(allRailGeometries(game));
    expect(preview).toHaveLength(2);
    const manager = game.railNetwork().stationManager();
    expect(
      manager.findStation(city2)!.getRailroadTo(manager.findStation(city1)!),
    ).not.toBeNull();
  });

  test("matches sequential planning for three promoted cities", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;
    for (const [x, y] of [
      [5, 5],
      [5, 25],
      [25, 35],
    ]) {
      player.buildUnit(UnitType.City, game.ref(x, y), {});
    }
    const factoryTile = game.ref(35, 15);

    const preview = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile);
    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    game.addExecution(new FactoryExecution(factory));
    for (let i = 0; i < 5; i++) game.executeNextTick();

    expect(previewGeometries(preview)).toEqual(allRailGeometries(game));
  });

  test("matches when a later city splits an earlier planned rail", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;
    player.buildUnit(UnitType.City, game.ref(5, 5), {});
    player.buildUnit(UnitType.City, game.ref(25, 7), {});
    const factoryTile = game.ref(45, 5);

    const preview = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile);
    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    game.addExecution(new FactoryExecution(factory));
    for (let i = 0; i < 5; i++) game.executeNextTick();

    expect(previewGeometries(preview)).toEqual(allRailGeometries(game));
    expect(preview).toHaveLength(2);
  });

  test("matches mixed port and city activation ordering", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;
    const port = player.buildUnit(UnitType.Port, game.ref(5, 5), {});
    game.addExecution(new PortExecution(port));
    game.executeNextTick();
    game.executeNextTick();
    player.buildUnit(UnitType.City, game.ref(5, 25), {});
    const factoryTile = game.ref(25, 15);

    const preview = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile);
    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    game.addExecution(new FactoryExecution(factory));
    for (let i = 0; i < 5; i++) game.executeNextTick();

    expect(previewGeometries(preview)).toEqual(allRailGeometries(game));
  });

  test("returns all final rails when placement produces more than five", async () => {
    const game = await setup("plains", {}, [
      playerInfo("player", PlayerType.Human),
    ]);
    const player = game.player("player")!;
    for (const [x, y] of [
      [5, 5],
      [25, 5],
      [45, 5],
      [65, 5],
      [5, 25],
      [25, 25],
      [45, 25],
    ]) {
      player.buildUnit(UnitType.City, game.ref(x, y), {});
    }
    const factoryTile = game.ref(80, 60);

    const preview = game
      .railNetwork()
      .computeGhostRailPaths(UnitType.Factory, factoryTile);
    const factory = player.buildUnit(UnitType.Factory, factoryTile, {});
    game.addExecution(new FactoryExecution(factory));
    for (let i = 0; i < 5; i++) game.executeNextTick();

    expect(preview.length).toBeGreaterThan(5);
    expect(previewGeometries(preview)).toEqual(allRailGeometries(game));
  });
});
