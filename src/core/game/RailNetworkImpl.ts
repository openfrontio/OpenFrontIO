import { PathFinding } from "../pathfinding/PathFinder";
import { Game, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType } from "./GameUpdates";
import { RailNetwork } from "./RailNetwork";
import { Railroad } from "./Railroad";
import { RailSpatialGrid } from "./RailroadSpatialGrid";
import { Cluster, TrainStation } from "./TrainStation";

/**
 * The Stations handle their own neighbors so the graph is naturally traversable,
 * but it would be expensive to look through the graph to find a station.
 * This class stores the existing stations for quick access
 */
export interface StationManager {
  addStation(station: TrainStation): void;
  removeStation(station: TrainStation): void;
  findStation(unit: Unit): TrainStation | null;
  getAll(): Set<TrainStation>;
  getById(id: number): TrainStation | undefined;
  count(): number;
}

export class StationManagerImpl implements StationManager {
  private stations: Set<TrainStation> = new Set();
  private stationsById: (TrainStation | undefined)[] = [];
  private nextId = 1; // Start from 1; 0 is reserved as invalid/sentinel

  addStation(station: TrainStation) {
    station.id = this.nextId++;
    this.stationsById[station.id] = station;
    this.stations.add(station);
  }

  removeStation(station: TrainStation) {
    this.stationsById[station.id] = undefined;
    this.stations.delete(station);
  }

  findStation(unit: Unit): TrainStation | null {
    for (const station of this.stations) {
      if (station.unit === unit) return station;
    }
    return null;
  }

  getAll(): Set<TrainStation> {
    return this.stations;
  }

  getById(id: number): TrainStation | undefined {
    return this.stationsById[id];
  }

  count(): number {
    return this.nextId;
  }
}

export interface RailPathFinderService {
  findTilePath(from: TileRef, to: TileRef): TileRef[];
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
}

class RailPathFinderServiceImpl implements RailPathFinderService {
  constructor(private game: Game) {}

  findTilePath(from: TileRef, to: TileRef): TileRef[] {
    return PathFinding.Rail(this.game).findPath(from, to) ?? [];
  }

  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[] {
    return PathFinding.Stations(this.game).findPath(from, to) ?? [];
  }
}

export function createRailNetwork(game: Game): RailNetwork {
  const stationManager = new StationManagerImpl();
  const pathService = new RailPathFinderServiceImpl(game);
  return new RailNetworkImpl(game, stationManager, pathService);
}

export class RailNetworkImpl implements RailNetwork {
  private maxConnectionDistance: number = 4;
  private stationRadius: number = 3;
  private gridCellSize: number = 4;
  private railGrid: RailSpatialGrid;
  private nextId: number = 0;

  constructor(
    private game: Game,
    private _stationManager: StationManager,
    private pathService: RailPathFinderService,
  ) {
    this.railGrid = new RailSpatialGrid(game, this.gridCellSize); // 4x4 tiles spatial grid
  }

  stationManager(): StationManager {
    return this._stationManager;
  }

  connectStation(station: TrainStation) {
    this._stationManager.addStation(station);
    if (!this.connectToExistingRails(station)) {
      this.connectToNearbyStations(station);
    }
  }

  removeStation(unit: Unit): void {
    const station = this._stationManager.findStation(unit);
    if (!station) return;

    const neighbors = station.neighbors();
    this.disconnectFromNetwork(station);
    this._stationManager.removeStation(station);

    const cluster = station.getCluster();
    if (!cluster) return;
    if (neighbors.length === 1) {
      cluster.removeStation(station);
    } else if (neighbors.length > 1) {
      for (const neighbor of neighbors) {
        const stations = this.computeCluster(neighbor);
        const newCluster = new Cluster();
        newCluster.addStations(stations);
      }
    }
    station.unit.setTrainStation(false);
  }

  /**
   * Return the intermediary stations connecting two stations
   */
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[] {
    return this.pathService.findStationsPath(from, to);
  }

  private connectToExistingRails(station: TrainStation): boolean {
    const rails = this.railGrid.query(station.tile(), this.stationRadius);

    const editedClusters = new Set<Cluster>();
    for (const rail of rails) {
      const from = rail.from;
      const to = rail.to;
      const originalId = rail.id;
      const closestRailIndex = rail.getClosestTileIndex(
        this.game,
        station.tile(),
      );
      if (closestRailIndex === 0 || closestRailIndex >= rail.tiles.length) {
        continue;
      }

      // Disconnect current rail as it will become invalid
      from.removeRailroad(rail);
      to.removeRailroad(rail);
      this.railGrid.unregister(rail);

      const newRailFrom = new Railroad(
        from,
        station,
        rail.tiles.slice(0, closestRailIndex),
        this.nextId++,
      );
      const newRailTo = new Railroad(
        station,
        to,
        rail.tiles.slice(closestRailIndex),
        this.nextId++,
      );

      // New station is connected to both new rails
      station.addRailroad(newRailFrom);
      station.addRailroad(newRailTo);
      // From and to are connected to the new segments
      from.addRailroad(newRailFrom);
      to.addRailroad(newRailTo);

      this.railGrid.register(newRailTo);
      this.railGrid.register(newRailFrom);
      const cluster = from.getCluster();
      if (cluster) {
        cluster.addStation(station);
        editedClusters.add(cluster);
      }
      this.game.addUpdate({
        type: GameUpdateType.RailroadSnapEvent,
        originalId,
        newId1: newRailFrom.id,
        newId2: newRailTo.id,
        tiles1: newRailFrom.tiles,
        tiles2: newRailTo.tiles,
      });
    }
    // If multiple clusters own the new station, merge them into a single cluster
    if (editedClusters.size > 1) {
      this.mergeClusters(editedClusters);
    }
    return editedClusters.size !== 0;
  }

  overlappingRailroads(tile: TileRef) {
    return [...this.railGrid.query(tile, this.stationRadius)].map(
      (railroad: Railroad) => railroad.id,
    );
  }

  private connectToNearbyStations(station: TrainStation) {
    const neighbors = this.game.nearbyUnits(
      station.tile(),
      this.game.config().trainStationMaxRange(),
      [UnitType.City, UnitType.Factory, UnitType.Port],
    );

    const editedClusters = new Set<Cluster>();
    neighbors.sort((a, b) => a.distSquared - b.distSquared);

    for (const neighbor of neighbors) {
      if (neighbor.unit === station.unit) continue;
      const neighborStation = this._stationManager.findStation(neighbor.unit);
      if (!neighborStation) continue;

      const distanceToStation = this.distanceFrom(
        neighborStation,
        station,
        this.maxConnectionDistance,
      );

      const neighborCluster = neighborStation.getCluster();
      if (neighborCluster === null) continue;
      const connectionAvailable =
        distanceToStation > this.maxConnectionDistance ||
        distanceToStation === -1;
      if (
        connectionAvailable &&
        neighbor.distSquared > this.game.config().trainStationMinRange() ** 2
      ) {
        if (this.connect(station, neighborStation)) {
          neighborCluster.addStation(station);
          editedClusters.add(neighborCluster);
        }
      }
    }

    // If multiple clusters own the new station, merge them into a single cluster
    if (editedClusters.size > 1) {
      this.mergeClusters(editedClusters);
    } else if (editedClusters.size === 0) {
      // If no cluster owns the station, creates a new one for it
      const newCluster = new Cluster();
      newCluster.addStation(station);
    }
  }

  private disconnectFromNetwork(station: TrainStation) {
    for (const rail of station.getRailroads()) {
      rail.delete(this.game);
      this.railGrid.unregister(rail);
    }
    station.clearRailroads();
    const cluster = station.getCluster();
    if (cluster !== null && cluster.size() === 1) {
      this.deleteCluster(cluster);
    }
  }

  private deleteCluster(cluster: Cluster) {
    for (const station of cluster.stations) {
      station.setCluster(null);
    }
    cluster.clear();
  }

  private connect(from: TrainStation, to: TrainStation) {
    const path = this.pathService.findTilePath(from.tile(), to.tile());
    if (path.length > 0 && path.length < this.game.config().railroadMaxSize()) {
      const railroad = new Railroad(from, to, path, this.nextId++);
      this.game.addUpdate({
        type: GameUpdateType.RailroadConstructionEvent,
        id: railroad.id,
        tiles: railroad.tiles,
      });
      from.addRailroad(railroad);
      to.addRailroad(railroad);
      this.railGrid.register(railroad);
      return true;
    }
    return false;
  }

  private distanceFrom(
    start: TrainStation,
    dest: TrainStation,
    maxDistance: number,
  ): number {
    if (start === dest) return 0;

    const visited = new Set<TrainStation>();
    const queue: Array<{ station: TrainStation; distance: number }> = [
      { station: start, distance: 0 },
    ];

    while (queue.length > 0) {
      const { station, distance } = queue.shift()!;
      if (visited.has(station)) continue;
      visited.add(station);

      if (distance >= maxDistance) continue;

      for (const neighbor of station.neighbors()) {
        if (neighbor === dest) return distance + 1;
        if (!visited.has(neighbor)) {
          queue.push({ station: neighbor, distance: distance + 1 });
        }
      }
    }

    // If destination not found within maxDistance
    return -1;
  }

  private computeCluster(start: TrainStation): Set<TrainStation> {
    const visited = new Set<TrainStation>();
    const queue = [start];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const neighbor of current.neighbors()) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    return visited;
  }

  private mergeClusters(clustersToMerge: Set<Cluster>) {
    const merged = new Cluster();
    for (const cluster of clustersToMerge) {
      merged.merge(cluster);
    }
  }
}
