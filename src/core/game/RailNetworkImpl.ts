import { z } from "zod";
import { PathFinding } from "../pathfinding/PathFinder";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { snapshotType, zInt, zRef } from "../snapshot/SnapshotType";
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

  snapshot(w: SnapshotWriter): { stations: number[]; nextId: number } {
    return {
      stations: [...this.stations].map((s) => w.station(s)),
      nextId: this.nextId,
    };
  }

  restoreSnapshot(
    s: { stations: number[]; nextId: number },
    r: SnapshotReader,
  ): void {
    this.stations = new Set(s.stations.map((i) => r.station(i)));
    this.stationsById = [];
    for (const station of this.stations) {
      this.stationsById[station.id] = station;
    }
    this.nextId = s.nextId;
  }
}

export interface RailPathFinderService {
  findTilePath(from: TileRef, to: TileRef): TileRef[];
  findStationsPath(from: TrainStation, to: TrainStation): TrainStation[];
}

interface RailGraphStation {
  tile(): TileRef;
  neighbors(): RailGraphStation[];
}

interface NearbyGraphStation<T extends RailGraphStation> {
  station: T;
  distSquared: number;
}

interface GhostRailroad {
  from: GhostTrainStation;
  to: GhostTrainStation;
  tiles: TileRef[];
  /** True when this geometry would be introduced by the proposed build. */
  ghost: boolean;
}

/**
 * A lightweight station used to dry-run the same connection rules as the live
 * rail network without mutating game state or allocating real station IDs.
 */
class GhostTrainStation implements RailGraphStation {
  private railroads = new Set<GhostRailroad>();

  constructor(
    private tileRef: TileRef,
    readonly unit: Unit | null,
    readonly canConnect: boolean,
  ) {}

  tile(): TileRef {
    return this.tileRef;
  }

  neighbors(): GhostTrainStation[] {
    const result: GhostTrainStation[] = [];
    for (const rail of this.railroads) {
      result.push(rail.from === this ? rail.to : rail.from);
    }
    return result;
  }

  addRailroad(railroad: GhostRailroad): void {
    this.railroads.add(railroad);
  }

  removeRailroad(railroad: GhostRailroad): void {
    this.railroads.delete(railroad);
  }
}

interface GhostRailNetworkState {
  stationsByUnit: Map<Unit, GhostTrainStation>;
  railroads: Set<GhostRailroad>;
  proposedFactory: GhostTrainStation | null;
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
  private dirtyClusters = new Set<Cluster>();

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

  recomputeClusters() {
    if (this.dirtyClusters.size === 0) return;

    for (const cluster of this.dirtyClusters) {
      const allOriginalStations = new Set(cluster.stations);
      while (allOriginalStations.size > 0) {
        const nextStation = allOriginalStations.values().next()
          .value as TrainStation;
        const allConnectedStations = this.computeCluster(nextStation);
        // Filter stations that are connected to the current cluster
        for (const connectedStation of allConnectedStations) {
          allOriginalStations.delete(connectedStation);
        }
        // Those stations were disconnected: new cluster
        if (allOriginalStations.size > 0) {
          const newCluster = new Cluster();
          // Switching their cluster will automatically remove them from their current cluster
          newCluster.addStations(allConnectedStations);
        }
      }
    }
    this.dirtyClusters.clear();
  }

  removeStation(unit: Unit): void {
    const station = this._stationManager.findStation(unit);
    if (!station) return;

    this.disconnectFromNetwork(station);
    this._stationManager.removeStation(station);
    station.unit.setTrainStation(false);

    const cluster = station.getCluster();
    if (!cluster) return;

    cluster.removeStation(station);
    if (cluster.size() === 0) {
      this.deleteCluster(cluster);
      this.dirtyClusters.delete(cluster);
      return;
    }

    this.dirtyClusters.add(cluster);
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

  overlappingRailroads(unitType: UnitType, tile: TileRef): TileRef[] {
    if (![UnitType.City, UnitType.Port, UnitType.Factory].includes(unitType)) {
      return [];
    }
    const tiles = new Set<TileRef>();
    for (const railroad of this.railGrid.query(tile, this.stationRadius)) {
      for (const t of railroad.tiles) {
        tiles.add(t);
      }
    }
    return Array.from(tiles).sort((a, b) => a - b);
  }

  computeGhostRailPaths(unitType: UnitType, tile: TileRef): TileRef[][] {
    if (![UnitType.City, UnitType.Port, UnitType.Factory].includes(unitType)) {
      return [];
    }

    const maxRange = this.game.config().trainStationMaxRange();

    // A City or Port only joins the rail network when a Factory is already in
    // range (see CityExecution/PortExecution). A Factory always becomes a
    // station and pulls nearby City/Port/Factory into the network itself, so
    // it needs no pre-existing factory to connect to.
    const buildingFactory = unitType === UnitType.Factory;
    if (
      !buildingFactory &&
      this.railGrid.query(tile, this.stationRadius).size
    ) {
      return [];
    }
    if (
      !buildingFactory &&
      !this.game.hasUnitNearby(tile, maxRange, UnitType.Factory)
    ) {
      return [];
    }

    const state = this.createGhostRailNetworkState();
    if (buildingFactory) {
      this.planFactoryGhostNetwork(state, tile, maxRange);
    } else {
      const station = new GhostTrainStation(tile, null, true);
      this.connectGhostStation(state, station);
    }

    return Array.from(state.railroads)
      .filter((railroad) => railroad.ghost)
      .map((railroad) => railroad.tiles);
  }

  /**
   * Simulate the station activation order caused by placing a Factory.
   * Existing Ports detect the new Factory in their already-running execution
   * before the new FactoryExecution runs. The Factory station comes next, then
   * FactoryExecution promotes completed Cities and any remaining structures in
   * the same UnitGrid order returned by nearbyUnits().
   */
  private planFactoryGhostNetwork(
    state: GhostRailNetworkState,
    tile: TileRef,
    maxRange: number,
  ): void {
    const structures = this.game.nearbyUnits(tile, maxRange, [
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
    ]);

    const pendingPorts = structures
      .map(({ unit }) => unit)
      .filter(
        (unit) =>
          unit.type() === UnitType.Port && !state.stationsByUnit.has(unit),
      )
      // Existing execution order follows construction order, represented by
      // monotonically increasing unit IDs.
      .sort((a, b) => a.id() - b.id());

    for (const port of pendingPorts) {
      this.addAndConnectGhostStation(state, port.tile(), port);
    }

    const factory = new GhostTrainStation(tile, null, true);
    state.proposedFactory = factory;
    this.connectGhostStation(state, factory);

    for (const { unit } of structures) {
      if (state.stationsByUnit.has(unit)) continue;
      this.addAndConnectGhostStation(state, unit.tile(), unit);
    }
  }

  private createGhostRailNetworkState(): GhostRailNetworkState {
    const stationsByUnit = new Map<Unit, GhostTrainStation>();
    const stationCopies = new Map<TrainStation, GhostTrainStation>();
    const railroads = new Set<GhostRailroad>();

    for (const station of this._stationManager.getAll()) {
      const copy = new GhostTrainStation(
        station.tile(),
        station.unit,
        station.getCluster() !== null,
      );
      stationsByUnit.set(station.unit, copy);
      stationCopies.set(station, copy);
    }

    const copiedRailroads = new Set<Railroad>();
    for (const station of this._stationManager.getAll()) {
      for (const railroad of station.getRailroads()) {
        if (copiedRailroads.has(railroad)) continue;
        copiedRailroads.add(railroad);
        const from = stationCopies.get(railroad.from);
        const to = stationCopies.get(railroad.to);
        if (!from || !to) continue;
        const copy: GhostRailroad = {
          from,
          to,
          tiles: railroad.tiles,
          ghost: false,
        };
        from.addRailroad(copy);
        to.addRailroad(copy);
        railroads.add(copy);
      }
    }

    return { stationsByUnit, railroads, proposedFactory: null };
  }

  private addAndConnectGhostStation(
    state: GhostRailNetworkState,
    tile: TileRef,
    unit: Unit,
  ): GhostTrainStation {
    const station = new GhostTrainStation(tile, unit, true);
    state.stationsByUnit.set(unit, station);
    this.connectGhostStation(state, station);
    return station;
  }

  private connectGhostStation(
    state: GhostRailNetworkState,
    station: GhostTrainStation,
  ): void {
    if (this.splitGhostRailroadsAtStation(state, station)) return;

    const neighbors: NearbyGraphStation<GhostTrainStation>[] = [];
    const nearbyUnits = this.game.nearbyUnits(
      station.tile(),
      this.game.config().trainStationMaxRange(),
      [UnitType.City, UnitType.Factory, UnitType.Port],
    );
    for (const { unit, distSquared } of nearbyUnits) {
      const neighbor = state.stationsByUnit.get(unit);
      if (!neighbor || neighbor === station || !neighbor.canConnect) continue;
      neighbors.push({ station: neighbor, distSquared });
    }

    const proposedFactory = state.proposedFactory;
    if (proposedFactory && proposedFactory !== station) {
      const distSquared = this.tileDistanceSquared(
        station.tile(),
        proposedFactory.tile(),
      );
      const maxRange = this.game.config().trainStationMaxRange();
      if (distSquared <= maxRange * maxRange) {
        neighbors.push({ station: proposedFactory, distSquared });
      }
    }
    neighbors.sort((a, b) => a.distSquared - b.distSquared);

    this.planNearbyConnections(station, neighbors, (to, path) => {
      const railroad: GhostRailroad = {
        from: station,
        to,
        tiles: path,
        ghost: true,
      };
      station.addRailroad(railroad);
      to.addRailroad(railroad);
      state.railroads.add(railroad);
    });
  }

  private splitGhostRailroadsAtStation(
    state: GhostRailNetworkState,
    station: GhostTrainStation,
  ): boolean {
    const railroads = this.ghostRailroadsNear(
      state,
      station.tile(),
      this.stationRadius,
    );
    let splitAny = false;

    for (const railroad of railroads) {
      const closestIndex = this.closestTileIndex(
        railroad.tiles,
        station.tile(),
      );
      if (closestIndex === 0 || closestIndex >= railroad.tiles.length) {
        continue;
      }

      railroad.from.removeRailroad(railroad);
      railroad.to.removeRailroad(railroad);
      state.railroads.delete(railroad);

      const fromHalf: GhostRailroad = {
        from: railroad.from,
        to: station,
        tiles: railroad.tiles.slice(0, closestIndex),
        ghost: railroad.ghost,
      };
      const toHalf: GhostRailroad = {
        from: station,
        to: railroad.to,
        tiles: railroad.tiles.slice(closestIndex),
        ghost: railroad.ghost,
      };
      railroad.from.addRailroad(fromHalf);
      station.addRailroad(fromHalf);
      station.addRailroad(toHalf);
      railroad.to.addRailroad(toHalf);
      state.railroads.add(fromHalf);
      state.railroads.add(toHalf);
      splitAny = true;
    }

    return splitAny;
  }

  private ghostRailroadsNear(
    state: GhostRailNetworkState,
    tile: TileRef,
    radius: number,
  ): GhostRailroad[] {
    const tileX = this.game.x(tile);
    const tileY = this.game.y(tile);
    const minCellX = Math.floor((tileX - radius) / this.gridCellSize);
    const maxCellX = Math.floor((tileX + radius) / this.gridCellSize);
    const minCellY = Math.floor((tileY - radius) / this.gridCellSize);
    const maxCellY = Math.floor((tileY + radius) / this.gridCellSize);

    return Array.from(state.railroads).filter((railroad) =>
      railroad.tiles.some((railTile) => {
        const cellX = Math.floor(this.game.x(railTile) / this.gridCellSize);
        const cellY = Math.floor(this.game.y(railTile) / this.gridCellSize);
        return (
          cellX >= minCellX &&
          cellX <= maxCellX &&
          cellY >= minCellY &&
          cellY <= maxCellY
        );
      }),
    );
  }

  private closestTileIndex(tiles: TileRef[], target: TileRef): number {
    if (tiles.length === 0) return -1;
    const targetX = this.game.x(target);
    const targetY = this.game.y(target);
    let closestIndex = 0;
    let closestDistance = Infinity;
    for (let i = 0; i < tiles.length; i++) {
      const dx = this.game.x(tiles[i]) - targetX;
      const dy = this.game.y(tiles[i]) - targetY;
      const distance = dx * dx + dy * dy;
      if (distance < closestDistance) {
        closestIndex = i;
        closestDistance = distance;
      }
    }
    return closestIndex;
  }

  private tileDistanceSquared(a: TileRef, b: TileRef): number {
    const dx = this.game.x(a) - this.game.x(b);
    const dy = this.game.y(a) - this.game.y(b);
    return dx * dx + dy * dy;
  }

  private connectToNearbyStations(station: TrainStation) {
    const neighbors = this.game.nearbyUnits(
      station.tile(),
      this.game.config().trainStationMaxRange(),
      [UnitType.City, UnitType.Factory, UnitType.Port],
    );

    const editedClusters = new Set<Cluster>();
    neighbors.sort((a, b) => a.distSquared - b.distSquared);
    const candidates: NearbyGraphStation<TrainStation>[] = [];
    for (const neighbor of neighbors) {
      if (neighbor.unit === station.unit) continue;
      const neighborStation = this._stationManager.findStation(neighbor.unit);
      if (!neighborStation) continue;
      if (neighborStation.getCluster() === null) continue;
      candidates.push({
        station: neighborStation,
        distSquared: neighbor.distSquared,
      });
    }

    this.planNearbyConnections(station, candidates, (neighbor, path) => {
      this.connectWithPath(station, neighbor, path);
      const neighborCluster = neighbor.getCluster();
      if (neighborCluster === null) return;
      neighborCluster.addStation(station);
      editedClusters.add(neighborCluster);
    });

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
  }

  private deleteCluster(cluster: Cluster) {
    for (const station of cluster.stations) {
      station.setCluster(null);
    }
    cluster.clear();
  }

  private connectWithPath(
    from: TrainStation,
    to: TrainStation,
    path: TileRef[],
  ): void {
    const railroad = new Railroad(from, to, path, this.nextId++);
    this.game.addUpdate({
      type: GameUpdateType.RailroadConstructionEvent,
      id: railroad.id,
      tiles: railroad.tiles,
    });
    from.addRailroad(railroad);
    to.addRailroad(railroad);
    this.railGrid.register(railroad);
  }

  private validRailPath(from: TileRef, to: TileRef): TileRef[] | null {
    const path = this.pathService.findTilePath(from, to);
    if (path.length > 0 && path.length < this.game.config().railroadMaxSize()) {
      return path;
    }
    return null;
  }

  private planNearbyConnections<T extends RailGraphStation>(
    station: T,
    neighbors: NearbyGraphStation<T>[],
    connect: (neighbor: T, path: TileRef[]) => void,
  ): void {
    const minRangeSquared = this.game.config().trainStationMinRange() ** 2;
    for (const neighbor of neighbors) {
      const distanceToStation = this.distanceFrom(
        neighbor.station,
        station,
        this.maxConnectionDistance,
      );
      const connectionAvailable =
        distanceToStation > this.maxConnectionDistance ||
        distanceToStation === -1;
      if (!connectionAvailable || neighbor.distSquared <= minRangeSquared) {
        continue;
      }

      const path = this.validRailPath(station.tile(), neighbor.station.tile());
      if (path !== null) connect(neighbor.station, path);
    }
  }

  private distanceFrom(
    start: RailGraphStation,
    dest: RailGraphStation,
    maxDistance: number,
  ): number {
    if (start === dest) return 0;

    const visited = new Set<RailGraphStation>();
    const queue: Array<{ station: RailGraphStation; distance: number }> = [
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

  snapshot(w: SnapshotWriter): RailNetworkState {
    const stationManager = this._stationManager as StationManagerImpl;
    return {
      stationManager: stationManager.snapshot(w),
      nextId: this.nextId,
      dirtyClusters: [...this.dirtyClusters].map((c) => w.cluster(c)),
      railGrid: this.railGrid.snapshot((r) => w.railroad(r)),
    };
  }

  /** Overwrites the dynamic state of a freshly constructed network. */
  restoreSnapshot(s: RailNetworkState, r: SnapshotReader): void {
    (this._stationManager as StationManagerImpl).restoreSnapshot(
      s.stationManager,
      r,
    );
    this.nextId = s.nextId;
    this.dirtyClusters = new Set(s.dirtyClusters.map((i) => r.cluster(i)));
    this.railGrid.restoreSnapshot(s.railGrid, (i) => r.railroad(i));
  }
}

export const RailNetworkSnapshot = snapshotType({
  name: "RailNetwork",
  version: 1,
  schema: z.object({
    stationManager: z.object({ stations: z.array(zRef()), nextId: zInt() }),
    nextId: zInt(),
    dirtyClusters: z.array(zRef()),
    railGrid: z.object({
      cells: z.array(z.tuple([z.string(), z.array(zRef())])),
      railToCells: z.array(z.tuple([zRef(), z.array(z.string())])),
    }),
  }),
});
export type RailNetworkState = z.infer<typeof RailNetworkSnapshot.schema>;
