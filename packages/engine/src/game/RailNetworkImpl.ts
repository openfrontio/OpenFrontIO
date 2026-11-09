import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  snapshotType,
  zInt,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { PathFinding } from "../pathfinding/PathFinder";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { Game, Unit } from "./Game";
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
  // First station added for each unit, so findStation needn't scan them all.
  // A unit can end up with two (a factory in range of another factory gets one
  // from each FactoryExecution), and findStation always answered the first.
  private stationsByUnit = new Map<Unit, TrainStation>();
  private nextId = 1; // Start from 1; 0 is reserved as invalid/sentinel

  addStation(station: TrainStation) {
    station.id = this.nextId++;
    this.stationsById[station.id] = station;
    this.stations.add(station);
    if (!this.stationsByUnit.has(station.unit)) {
      this.stationsByUnit.set(station.unit, station);
    }
  }

  removeStation(station: TrainStation) {
    this.stationsById[station.id] = undefined;
    // Drop trailing empty slots so the array matches what restoreSnapshot rebuilds
    while (
      this.stationsById.length > 0 &&
      this.stationsById[this.stationsById.length - 1] === undefined
    ) {
      this.stationsById.pop();
    }
    this.stations.delete(station);
    if (this.stationsByUnit.get(station.unit) === station) {
      // The unit's next station, if any, takes over. Rebuild rather than
      // re-insert so the Map keeps the order restoreSnapshot produces.
      this.rebuildStationsByUnit();
    }
  }

  findStation(unit: Unit): TrainStation | null {
    return this.stationsByUnit.get(unit) ?? null;
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
    this.rebuildStationsByUnit();
    this.nextId = s.nextId;
  }

  /** The first station of each unit, in `stations` order. */
  private rebuildStationsByUnit(): void {
    this.stationsByUnit = new Map();
    for (const station of this.stations) {
      if (!this.stationsByUnit.has(station.unit)) {
        this.stationsByUnit.set(station.unit, station);
      }
    }
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

/** Pathfinder calls a ghost plan may still spend; the plan stops at zero. */
interface PathBudget {
  remaining: number;
}

/**
 * Structures a factory preview promotes. A first factory in a crowded region
 * would promote every City, Port and Factory within range, a hundred or more
 * in a busy FFA, which is too much to plan and draw at interactive rates and
 * too much to read. Past this many, the preview keeps the nearest ones.
 */
const GHOST_CASCADE_LIMIT = 12;
/**
 * Pathfinder calls one ghost preview may spend before it is cut short, a
 * backstop behind the cascade limit for a station that would connect to many
 * stations at once. Main spent at most five per preview.
 */
const GHOST_PATHFINDER_BUDGET = 32;
/** Recent previews remembered per network; a cursor rarely hovers more tiles. */
const GHOST_PATHS_CACHE_SIZE = 32;

interface GhostPathsCacheEntry {
  networkVersion: number;
  structureVersion: number;
  paths: TileRef[][];
}

interface GhostRailroad {
  from: GhostTrainStation;
  to: GhostTrainStation;
  tiles: TileRef[];
  /** True when this geometry would be introduced by the proposed build. */
  ghost: boolean;
  /** The live railroad this stands for; unset for rails the plan created or split. */
  live?: Railroad;
}

/**
 * A lightweight station used to dry-run the same connection rules as the live
 * rail network without mutating game state or allocating real station IDs.
 * It stands in either for a live station, wrapped when the plan first reaches
 * it, or for a structure the proposed build would create or promote.
 */
class GhostTrainStation implements RailGraphStation {
  private railroads = new Set<GhostRailroad>();

  constructor(
    private readonly state: GhostRailNetworkState,
    private tileRef: TileRef,
    readonly canConnect: boolean,
    /** The live station this ghost stands in for; null for stations the build would add. */
    readonly live: TrainStation | null,
  ) {}

  tile(): TileRef {
    return this.tileRef;
  }

  neighbors(): GhostTrainStation[] {
    const result: GhostTrainStation[] = [];
    if (this.live !== null) {
      for (const rail of this.live.getRailroads()) {
        if (this.state.removedLiveRails.has(rail)) continue;
        result.push(
          this.state.ghostForStation(
            rail.from === this.live ? rail.to : rail.from,
          ),
        );
      }
    }
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

/**
 * Scratch state for one ghost plan. Live stations are wrapped only when the
 * plan reaches them and live rails are read through the rail grid, so a
 * preview costs in proportion to what it touches, not to the whole map.
 */
export class GhostRailNetworkState {
  /**
   * Ghosts for the structures the proposed build would create or promote. A
   * unit with a live station is never here: it resolves through the station
   * manager, as the live network does, even when it has more than one.
   */
  private readonly ghostByUnit = new Map<Unit, GhostTrainStation>();
  private readonly ghostByStation = new Map<TrainStation, GhostTrainStation>();
  /** Rails this plan created or split; live rails are found through the grid. */
  readonly newRailroads = new Set<GhostRailroad>();
  /** Live rails this plan split; their halves are in newRailroads. */
  readonly removedLiveRails = new Set<Railroad>();
  proposedFactory: GhostTrainStation | null = null;
  readonly budget: PathBudget;

  constructor(
    private readonly stationManager: StationManager,
    pathfinderBudget: number,
  ) {
    this.budget = { remaining: pathfinderBudget };
  }

  /** The ghost for `unit`'s station, or undefined when it isn't a station (yet). */
  ghostForUnit(unit: Unit): GhostTrainStation | undefined {
    const ghost = this.ghostByUnit.get(unit);
    if (ghost !== undefined) return ghost;
    const station = this.stationManager.findStation(unit);
    return station ? this.ghostForStation(station) : undefined;
  }

  ghostForStation(station: TrainStation): GhostTrainStation {
    let ghost = this.ghostByStation.get(station);
    if (ghost === undefined) {
      ghost = new GhostTrainStation(
        this,
        station.tile(),
        station.getCluster() !== null,
        station,
      );
      this.ghostByStation.set(station, ghost);
    }
    return ghost;
  }

  /** A station the proposed build would create (unit null) or promote. */
  addGhostStation(tile: TileRef, unit: Unit | null): GhostTrainStation {
    const ghost = new GhostTrainStation(this, tile, true, null);
    if (unit !== null) this.ghostByUnit.set(unit, ghost);
    return ghost;
  }

  isStation(unit: Unit): boolean {
    return this.ghostForUnit(unit) !== undefined;
  }
}

class RailPathFinderServiceImpl implements RailPathFinderService {
  constructor(private game: Game) {}

  findTilePath(from: TileRef, to: TileRef): TileRef[] {
    // PathFinding.Rail shares one search engine per game; only the small
    // stepper is built per call.
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
  // Preview-only state: a memo over pure functions of the network. Never part
  // of the snapshot and never read by the simulation itself.
  private networkVersion = 0;
  private ghostCascadeLimit = GHOST_CASCADE_LIMIT;
  private ghostPathfinderBudget = GHOST_PATHFINDER_BUDGET;
  private readonly ghostPathsCache = new Map<string, GhostPathsCacheEntry>();

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
    this.networkVersion++;
    this._stationManager.addStation(station);
    if (!this.connectToExistingRails(station)) {
      this.connectToNearbyStations(station);
    }
  }

  recomputeClusters() {
    if (this.dirtyClusters.size === 0) return;
    this.networkVersion++;

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
    this.networkVersion++;

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

    // The client asks for the preview under the cursor on every game update,
    // so a still cursor must cost nothing: memoise on everything a plan reads,
    // the rail network and the structure/terrain version.
    const structureVersion = this.game.structureVersion();
    const key = `${unitType}:${tile}`;
    const cached = this.ghostPathsCache.get(key);
    if (cached !== undefined) {
      this.ghostPathsCache.delete(key);
      if (
        cached.networkVersion === this.networkVersion &&
        cached.structureVersion === structureVersion
      ) {
        // Re-insert so the entry counts as the most recently used.
        this.ghostPathsCache.set(key, cached);
        return cached.paths;
      }
    }

    const paths = this.planGhostRailPaths(unitType, tile);
    this.ghostPathsCache.set(key, {
      networkVersion: this.networkVersion,
      structureVersion,
      paths,
    });
    if (this.ghostPathsCache.size > GHOST_PATHS_CACHE_SIZE) {
      const oldest = this.ghostPathsCache.keys().next().value;
      if (oldest !== undefined) this.ghostPathsCache.delete(oldest);
    }
    return paths;
  }

  private planGhostRailPaths(unitType: UnitType, tile: TileRef): TileRef[][] {
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

    const state = new GhostRailNetworkState(
      this._stationManager,
      this.ghostPathfinderBudget,
    );
    if (buildingFactory) {
      this.planFactoryGhostNetwork(state, tile, maxRange);
    } else {
      this.connectGhostStation(state, state.addGhostStation(tile, null));
    }

    return Array.from(state.newRailroads)
      .filter((railroad) => railroad.ghost)
      .map((railroad) => railroad.tiles);
  }

  /**
   * Simulate the station activation order caused by placing a Factory.
   * Existing Ports detect the new Factory in their already-running execution
   * before the new FactoryExecution runs. The Factory station comes next, then
   * FactoryExecution promotes completed Cities and any remaining structures in
   * the same UnitGrid order returned by nearbyUnits().
   *
   * Two limits keep this interactive. Past GHOST_CASCADE_LIMIT structures to
   * promote, only the nearest ones are planned, in their relative order; a
   * farther structure the game would have processed first can then no longer
   * influence them, so that preview is local rather than exact. The cascade
   * also stops once the plan's pathfinder budget is spent, leaving a prefix.
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

    // The structures the factory would promote, in the order the game
    // processes them (UnitGrid order).
    let pending = structures.filter(({ unit }) => !state.isStation(unit));
    if (pending.length > this.ghostCascadeLimit) {
      const nearest = new Set(
        [...pending]
          .sort((a, b) => a.distSquared - b.distSquared)
          .slice(0, this.ghostCascadeLimit)
          .map(({ unit }) => unit),
      );
      pending = pending.filter(({ unit }) => nearest.has(unit));
    }

    const pendingPorts = pending
      .map(({ unit }) => unit)
      .filter((unit) => unit.type() === UnitType.Port)
      // Existing execution order follows construction order, represented by
      // monotonically increasing unit IDs.
      .sort((a, b) => a.id() - b.id());

    for (const port of pendingPorts) {
      if (state.budget.remaining <= 0) return;
      this.connectGhostStation(state, state.addGhostStation(port.tile(), port));
    }

    if (state.budget.remaining <= 0) return;
    const factory = state.addGhostStation(tile, null);
    state.proposedFactory = factory;
    this.connectGhostStation(state, factory);

    for (const { unit } of pending) {
      if (state.budget.remaining <= 0) return;
      if (state.isStation(unit)) continue;
      this.connectGhostStation(state, state.addGhostStation(unit.tile(), unit));
    }
  }

  private connectGhostStation(
    state: GhostRailNetworkState,
    station: GhostTrainStation,
  ): void {
    if (this.splitGhostRailroadsAtStation(state, station)) return;

    const maxRange = this.game.config().trainStationMaxRange();
    const neighbors: NearbyGraphStation<GhostTrainStation>[] = [];
    const nearbyUnits = this.game.nearbyUnits(station.tile(), maxRange, [
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
    ]);
    for (const { unit, distSquared } of nearbyUnits) {
      const neighbor = state.ghostForUnit(unit);
      if (
        neighbor === undefined ||
        neighbor === station ||
        !neighbor.canConnect
      ) {
        continue;
      }
      neighbors.push({ station: neighbor, distSquared });
    }

    const proposedFactory = state.proposedFactory;
    if (proposedFactory && proposedFactory !== station) {
      const distSquared = this.tileDistanceSquared(
        station.tile(),
        proposedFactory.tile(),
      );
      if (distSquared <= maxRange * maxRange) {
        neighbors.push({ station: proposedFactory, distSquared });
      }
    }
    neighbors.sort((a, b) => a.distSquared - b.distSquared);

    this.planNearbyConnections(
      station,
      neighbors,
      (to, path) => {
        const railroad: GhostRailroad = {
          from: station,
          to,
          tiles: path,
          ghost: true,
        };
        station.addRailroad(railroad);
        to.addRailroad(railroad);
        state.newRailroads.add(railroad);
      },
      state.budget,
    );
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

      if (railroad.live !== undefined) {
        // Hide the live rail from this plan; the halves below stand in for it.
        state.removedLiveRails.add(railroad.live);
      } else {
        railroad.from.removeRailroad(railroad);
        railroad.to.removeRailroad(railroad);
        state.newRailroads.delete(railroad);
      }

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
      state.newRailroads.add(fromHalf);
      state.newRailroads.add(toHalf);
      splitAny = true;
    }

    return splitAny;
  }

  /**
   * Rails within `radius` of `tile`: live ones through the rail grid, then
   * the few this plan created or split, which the grid doesn't know about.
   */
  private ghostRailroadsNear(
    state: GhostRailNetworkState,
    tile: TileRef,
    radius: number,
  ): GhostRailroad[] {
    const result: GhostRailroad[] = [];
    for (const rail of this.railGrid.query(tile, radius)) {
      if (state.removedLiveRails.has(rail)) continue;
      result.push({
        from: state.ghostForStation(rail.from),
        to: state.ghostForStation(rail.to),
        tiles: rail.tiles,
        ghost: false,
        live: rail,
      });
    }
    if (state.newRailroads.size === 0) return result;

    // Same cell test as RailSpatialGrid.query, applied to the unregistered rails.
    const tileX = this.game.x(tile);
    const tileY = this.game.y(tile);
    const minCellX = Math.floor((tileX - radius) / this.gridCellSize);
    const maxCellX = Math.floor((tileX + radius) / this.gridCellSize);
    const minCellY = Math.floor((tileY - radius) / this.gridCellSize);
    const maxCellY = Math.floor((tileY + radius) / this.gridCellSize);
    for (const railroad of state.newRailroads) {
      const near = railroad.tiles.some((railTile) => {
        const cellX = Math.floor(this.game.x(railTile) / this.gridCellSize);
        const cellY = Math.floor(this.game.y(railTile) / this.gridCellSize);
        return (
          cellX >= minCellX &&
          cellX <= maxCellX &&
          cellY >= minCellY &&
          cellY <= maxCellY
        );
      });
      if (near) result.push(railroad);
    }
    return result;
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

  /**
   * Connect `station` to each neighbor not already within
   * maxConnectionDistance rail hops of it. With a `budget`, stop once it is
   * spent; the live network passes none.
   */
  private planNearbyConnections<T extends RailGraphStation>(
    station: T,
    neighbors: NearbyGraphStation<T>[],
    connect: (neighbor: T, path: TileRef[]) => void,
    budget?: PathBudget,
  ): void {
    const minRangeSquared = this.game.config().trainStationMinRange() ** 2;
    // Rails are undirected, so one search out from the station tells for every
    // neighbor at once whether it is already in reach. Each new rail extends
    // the reach, so the search is redone after one.
    let reachable = this.stationsWithin(station, this.maxConnectionDistance);
    for (const neighbor of neighbors) {
      if (budget !== undefined && budget.remaining <= 0) return;
      if (
        reachable.has(neighbor.station) ||
        neighbor.distSquared <= minRangeSquared
      ) {
        continue;
      }

      if (budget !== undefined) budget.remaining--;
      const path = this.validRailPath(station.tile(), neighbor.station.tile());
      if (path !== null) {
        connect(neighbor.station, path);
        reachable = this.stationsWithin(station, this.maxConnectionDistance);
      }
    }
  }

  /** Every station within `maxDistance` rail hops of `start`, itself included. */
  private stationsWithin(
    start: RailGraphStation,
    maxDistance: number,
  ): Set<RailGraphStation> {
    const visited = new Set<RailGraphStation>([start]);
    let frontier: RailGraphStation[] = [start];
    for (let hop = 0; hop < maxDistance && frontier.length > 0; hop++) {
      const next: RailGraphStation[] = [];
      for (const station of frontier) {
        for (const neighbor of station.neighbors()) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return visited;
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

  /**
   * Order-independent digest of every station and rail (id, length, end
   * tiles), so a restored network hashes the same although its sets are
   * rebuilt. Each rail is counted once, from its `from` station.
   */
  hash(): number {
    let hash = 0;
    for (const station of this._stationManager.getAll()) {
      hash = (hash + station.unit.id() * 7919) >>> 0;
      for (const rail of station.getRailroads()) {
        if (rail.from !== station) continue;
        const tiles = rail.tiles;
        const ends =
          tiles.length === 0 ? 0 : tiles[0] * 3 + tiles[tiles.length - 1];
        hash = (hash + (rail.id + 1) * (tiles.length * 31 + ends)) >>> 0;
      }
    }
    return hash;
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
    this.networkVersion++;
    this.ghostPathsCache.clear();
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
