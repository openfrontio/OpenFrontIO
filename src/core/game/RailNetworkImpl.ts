import { RailroadExecution } from "../execution/RailroadExecution";
import { PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";
import { SerialAStar } from "../pathfinding/SerialAStar";
import { Game, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";
import { RailNetwork } from "./RailNetwork";
import { Railroad } from "./Railroad";
import { Cluster, TrainStation, TrainStationMapAdapter } from "./TrainStation";

/**
 * The Stations handle their own neighbors so the graph is naturally traversable,
 * but it would be expensive to look through the graph to find a station.
 * This class stores the existing stations for quick access
 */
export type StationManager = {
  addStation(station: TrainStation): void;
  removeStation(station: TrainStation): void;
  findStation(unit: Unit): TrainStation | null;
  getAll(): Set<TrainStation>;
};

export class StationManagerImpl implements StationManager {
  private readonly stations: Set<TrainStation> = new Set();

  addStation(station: TrainStation) {
    this.stations.add(station);
  }

  removeStation(station: TrainStation) {
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
}

export type RailPathFinderService = {
  findTilePath(from: TileRef, to: TileRef): TileRef[];
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
};

class RailPathFinderServiceImpl implements RailPathFinderService {
  constructor(private readonly game: Game) {}

  findTilePath(from: TileRef, to: TileRef): TileRef[] {
    const astar = new MiniAStar(
      this.game.map(),
      this.game.miniMap(),
      from,
      to,
      5000,
      20,
      false,
      3,
    );
    return astar.compute() === PathFindResultType.Completed
      ? astar.reconstructPath()
      : [];
  }

  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[] {
    const stationAStar = new SerialAStar(
      from,
      to,
      5000,
      20,
      new TrainStationMapAdapter(this.game),
    );
    return stationAStar.compute() === PathFindResultType.Completed
      ? stationAStar.reconstructPath()
      : [];
  }
}

export function createRailNetwork(game: Game): RailNetwork {
  const stationManager = new StationManagerImpl();
  const pathService = new RailPathFinderServiceImpl(game);
  return new RailNetworkImpl(game, stationManager, pathService);
}

export class RailNetworkImpl implements RailNetwork {
  private readonly maxConnectionDistance = 4;

  constructor(
    private readonly game: Game,
    private readonly stationManager: StationManager,
    private readonly pathService: RailPathFinderService,
  ) {}

  connectStation(station: TrainStation) {
    this.stationManager.addStation(station);
    this.connectToNearbyStations(station);
  }

  removeStation(unit: Unit): void {
    const station = this.stationManager.findStation(unit);
    if (!station) return;

    const neighbors = station.neighbors();
    this.disconnectFromNetwork(station);
    this.stationManager.removeStation(station);

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
      const neighborStation = this.stationManager.findStation(neighbor.unit);
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
      const railRoad = new Railroad(from, to, path);
      this.game.addExecution(new RailroadExecution(railRoad));
      from.addRailroad(railRoad);
      to.addRailroad(railRoad);
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
      { distance: 0, station: start },
    ];

    let head = 0;
    while (head < queue.length) {
      const { station, distance } = queue[head++];
      if (visited.has(station)) continue;
      visited.add(station);

      if (distance >= maxDistance) continue;

      for (const neighbor of station.neighbors()) {
        if (neighbor === dest) return distance + 1;
        if (!visited.has(neighbor)) {
          queue.push({ distance: distance + 1, station: neighbor });
        }
      }
    }

    // If destination not found within maxDistance
    return -1;
  }

  private computeCluster(start: TrainStation): Set<TrainStation> {
    const visited = new Set<TrainStation>();
    const queue = [start];

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
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
