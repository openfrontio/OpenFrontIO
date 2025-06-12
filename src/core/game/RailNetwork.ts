import { RailRoadExecution } from "../execution/RailRoadExecution";
import { PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";
import { GraphAdapter, SerialAStar } from "../pathfinding/SerialAStar";
import { Unit, UnitType } from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { TrainStation } from "./TrainStation";

export type RailRoad = {
  from: TrainStation;
  to: TrainStation;
  tiles: TileRef[];
};

/**
 * Wrap a railroad with a direction so it always starts at tiles[0]
 */
export class OrientedRailroad {
  private tiles: TileRef[] = [];
  constructor(
    private railroad: RailRoad,
    private forward: boolean,
  ) {
    this.tiles = this.forward
      ? this.railroad.tiles
      : [...this.railroad.tiles].reverse();
  }

  getTiles(): TileRef[] {
    return this.tiles;
  }

  getStart(): TrainStation {
    return this.forward ? this.railroad.from : this.railroad.to;
  }

  getEnd(): TrainStation {
    return this.forward ? this.railroad.to : this.railroad.from;
  }
}

/**
 * Adapt the railnetwork to be traversable by A*
 */
export class RailNetworkMapAdapter implements GraphAdapter<TrainStation> {
  constructor(private mg: GameImpl) {}

  neighbors(node: TrainStation): TrainStation[] {
    return node.neighbors();
  }

  cost(node: TrainStation): number {
    return 1;
  }

  position(node: TrainStation): { x: number; y: number } {
    return { x: this.mg.x(node.tile()), y: this.mg.y(node.tile()) };
  }

  isTraversable(from: TrainStation, to: TrainStation): boolean {
    return true;
  }
}

/**
 * Cluster of connected stations
 */
export class Cluster {
  public stations: Set<TrainStation> = new Set();

  has(station: TrainStation) {
    return this.stations.has(station);
  }

  addStation(station: TrainStation) {
    this.stations.add(station);
    station.setCluster(this);
  }

  removeStation(station: TrainStation) {
    this.stations.delete(station);
  }

  addStations(stations: Set<TrainStation>) {
    for (const station of stations) {
      this.addStation(station);
    }
  }

  merge(other: Cluster) {
    this.stations = new Set([...this.stations, ...other.stations]);
  }
}

/**
 * Handles the rail graph
 */
export class RailNetwork {
  private railAStar: MiniAStar;
  private stationAStar: SerialAStar<TrainStation>;
  private clusters: Set<Cluster> = new Set(); // Precompute clusters for quick access
  private stations: Set<TrainStation> = new Set(); // Store them for quick access
  private minStationRange: number = 15;
  private maxStationRange: number = 80;
  private maxPathSize: number = 100;

  constructor(private mg: GameImpl) {}

  public connectStation(station: TrainStation) {
    this.stations.add(station);
    this.connectToNearbyStations(station);
  }

  removeStation(unit: Unit): void {
    const stationToRemove = Array.from(this.stations).find(
      (station) => station.unit === unit,
    );
    if (stationToRemove) {
      const neighbors = stationToRemove.neighbors();
      this.disconnectStationFromNetwork(stationToRemove);
      if (neighbors.length > 1) {
        // Station was not a terminal station, split its cluster
        this.splitStationCluster(stationToRemove);
      } else {
        // Station was a terminal station: simply remove it from the cluster
        stationToRemove.getCluster().removeStation(stationToRemove);
        if (stationToRemove.getCluster().stations.size === 0) {
          this.clusters.delete(stationToRemove.getCluster());
        }
      }
    }
  }

  private splitStationCluster(stationToRemove: TrainStation): void {
    const neighbors = stationToRemove.neighbors();
    if (neighbors.length > 1) {
      // Remove the cluster entirely
      this.clusters.delete(stationToRemove.getCluster());
      // Then recompute all neighbors clusters
      const newClusters: Set<Cluster> = new Set();
      for (const neighbor of neighbors) {
        const stations = this.computeCluster(neighbor);
        const cluster = new Cluster();
        cluster.addStations(stations);
        this.clusters.add(cluster);
      }
    }
  }

  getOrientedRailroad(
    from: TrainStation,
    to: TrainStation,
  ): OrientedRailroad | null {
    for (const railroad of from.getRailroads()) {
      if (railroad.from === to) {
        return new OrientedRailroad(railroad, false);
      } else if (railroad.to === to) {
        return new OrientedRailroad(railroad, true);
      }
    }
    return null;
  }

  connectStations(from: TrainStation, to: TrainStation): boolean {
    const tiles: TileRef[] = this.findPath(from.tile(), to.unit.tile());
    if (tiles.length > 0 && tiles.length < this.maxPathSize) {
      const railRoad: RailRoad = { from, to, tiles };
      this.mg.addExecution(new RailRoadExecution(railRoad));
      from.addRailRoad(railRoad);
      to.addRailRoad(railRoad);
      return true;
    }
    return false;
  }

  disconnectStationFromNetwork(station: TrainStation) {
    const neighbors = station.neighbors();
    // Remove the station from the quick access stations set
    this.stations.delete(station);

    // Remove the neighbor railroads accessing the station
    for (const neighbor of neighbors) {
      neighbor.removeNeighboringRails(station);
    }
  }

  connectToNearbyStations(station: TrainStation) {
    const neighbors = this.mg.nearbyUnits(
      station.tile(),
      this.maxStationRange,
      [UnitType.City, UnitType.Factory, UnitType.Port],
    );
    neighbors.sort((a, b) => a.distSquared - b.distSquared); // Closest first
    const editedClusters: Set<Cluster> = new Set();
    for (const neighbor of neighbors) {
      const neighborUnit = neighbor.unit;
      if (neighborUnit === station.unit) continue; // skip self

      const neighborStation = this.findStation(neighborUnit);
      if (!neighborStation) {
        continue; // Not a train station
      }

      const neighborCluster = neighborStation.getCluster();
      const clusterAlreadyConnected = neighborCluster.has(station);

      if (
        !clusterAlreadyConnected &&
        neighbor.distSquared > this.minStationRange
      ) {
        neighborCluster.addStation(station);
        if (this.connectStations(station, neighborStation)) {
          editedClusters.add(neighborCluster);
        }
      }
    }
    if (editedClusters.size > 1) {
      // If many clusters have been edited, we should merge them as a single cluster
      this.mergeClusters(editedClusters);
    } else if (editedClusters.size === 0) {
      this.createCluster(station);
    }
  }

  /**
   * A cluster is always created with a single station
   */
  private createCluster(station: TrainStation) {
    const newCluster = new Cluster();
    newCluster.addStation(station);
    this.clusters.add(newCluster);
  }

  /**
   * Merge then remove @p clusters, then add the newly created cluster
   */
  private mergeClusters(clusters: Set<Cluster>) {
    const mergedCluster: Cluster = new Cluster();
    for (const toMerge of clusters) {
      mergedCluster.merge(toMerge);
      for (const station of toMerge.stations) {
        station.setCluster(mergedCluster);
      }
      this.clusters.delete(toMerge);
    }
    this.clusters.add(mergedCluster);
  }

  private findStation(unit: Unit): TrainStation | null {
    for (const station of this.stations) {
      if (station.unit === unit) {
        return station;
      }
    }
    return null;
  }

  /**
   * Return the list of stations connected to @p start
   */
  private computeCluster(start: TrainStation): Set<TrainStation> {
    const visited = new Set<TrainStation>();
    const queue: TrainStation[] = [start];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const neighbor of current.neighbors()) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    return visited;
  }

  findStationsPath(
    from: TrainStation,
    to: TrainStation,
  ): TrainStation[] | null {
    this.stationAStar = new SerialAStar(
      from,
      to,
      5000,
      20,
      new RailNetworkMapAdapter(this.mg),
    );
    let fullPath: TrainStation[] = [];
    switch (this.stationAStar.compute()) {
      case PathFindResultType.Completed:
        fullPath = this.stationAStar.reconstructPath();
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
      default:
    }
    return fullPath;
  }

  private findPath(from: TileRef, to: TileRef): TileRef[] {
    this.railAStar = new MiniAStar(
      this.mg.map(),
      this.mg.miniMap(),
      from,
      to,
      5000,
      20,
      false,
      3,
    );
    let tiles: TileRef[] = [];
    switch (this.railAStar.compute()) {
      case PathFindResultType.Completed:
        tiles = this.railAStar.reconstructPath();
        break;
      case PathFindResultType.Pending:
      case PathFindResultType.PathNotFound:
      default:
        break;
    }
    return tiles;
  }
}
