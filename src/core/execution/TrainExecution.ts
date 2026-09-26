import { z } from "zod";
import {
  Execution,
  Game,
  Player,
  TrainType,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { RailNetwork } from "../game/RailNetwork";
import { getOrientedRailroad, OrientedRailroad } from "../game/Railroad";
import { TrainStation } from "../game/TrainStation";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zPlayerRef, zRef, zTiles } from "../snapshot/SnapshotType";

export class TrainExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private train: Unit | null = null; // primary unit
  private cars: Unit[] = []; // stored back to front
  private hasCargo: boolean = false;
  private currentTile: number = 0;
  private spacing = 2;
  private usedTiles: TileRef[] = []; // used for cars behind
  private stations: TrainStation[] = [];
  private currentRailroad: OrientedRailroad | null = null;
  private speed: number = 2;
  private _tradeStopsVisited: number = 0;
  private pathTiles: TileRef[] = [];
  private pathIndex: number = 0;

  constructor(
    private railNetwork: RailNetwork,
    private player: Player,
    private source: TrainStation,
    private destination: TrainStation,
    private numCars: number,
  ) {}

  public owner(): Player {
    return this.player;
  }

  public tradeStopsVisited(): number {
    return this._tradeStopsVisited;
  }

  public sourceLevel(): number {
    return this.source.unit.level();
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stations = this.railNetwork.findStationsPath(
      this.source,
      this.destination,
    );
    if (!stations || stations.length <= 1) {
      this.active = false;
      return;
    }

    this.stations = stations;
    const railroad = getOrientedRailroad(this.stations[0], this.stations[1]);
    if (railroad) {
      this.currentRailroad = railroad;
    } else {
      this.active = false;
      return;
    }

    const spawn = this.player.canBuild(UnitType.Train, this.stations[0].tile());
    if (spawn === false) {
      console.warn(`cannot build train`);
      this.active = false;
      return;
    }
    this.train = this.createTrainUnits(spawn);

    const carUnitIds = this.cars.map((c) => c.id());
    const pathTiles: TileRef[] = [];
    for (let i = 0; i + 1 < this.stations.length; i++) {
      const segment = getOrientedRailroad(
        this.stations[i],
        this.stations[i + 1],
      );
      if (!segment) {
        this.active = false;
        return;
      }
      pathTiles.push(...segment.getTiles());
    }
    const startTile = this.train.tile();
    if (pathTiles.length === 0 || pathTiles[0] !== startTile) {
      pathTiles.unshift(startTile);
      this.pathIndex = 1;
    }
    this.pathTiles = pathTiles;

    const plan: MotionPlanRecord = {
      kind: "train",
      engineUnitId: this.train.id(),
      carUnitIds,
      planId: 1,
      startTick: ticks + 1,
      speed: this.speed,
      spacing: this.spacing,
      path: pathTiles,
    };
    this.mg.recordMotionPlan(plan);
  }

  tick(ticks: number): void {
    if (this.train === null) {
      throw new Error("Not initialized");
    }

    if (!this.train.isActive() || !this.activeSourceOrDestination()) {
      this.deleteTrain();
      return;
    }

    const tile = this.getNextTile();
    if (tile) {
      this.updateCarsPositions(tile);
    } else {
      this.targetReached();
      this.deleteTrain();
    }
  }

  loadCargo() {
    if (this.hasCargo || this.train === null) {
      return;
    }
    this.hasCargo = true;
    // Starts at 1: don't load tail engine
    for (let i = 1; i < this.cars.length; i++) {
      this.cars[i].setLoaded(true);
    }
  }

  private targetReached() {
    if (this.train === null) {
      return;
    }
    this.train.setReachedTarget();
    this.cars.forEach((car: Unit) => {
      car.setReachedTarget();
    });
  }

  private createTrainUnits(tile: TileRef): Unit {
    const train = this.player.buildUnit(UnitType.Train, tile, {
      targetUnit: this.destination.unit,
      trainType: TrainType.Engine,
    });
    // Tail is also an engine, just for cosmetics
    this.cars.push(
      this.player.buildUnit(UnitType.Train, tile, {
        targetUnit: this.destination.unit,
        trainType: TrainType.TailEngine,
      }),
    );
    for (let i = 0; i < this.numCars; i++) {
      this.cars.push(
        this.player.buildUnit(UnitType.Train, tile, {
          trainType: TrainType.Carriage,
          loaded: this.hasCargo,
        }),
      );
    }
    return train;
  }

  private deleteTrain() {
    this.active = false;
    if (this.train?.isActive()) {
      this.train.delete(false);
    }
    for (const car of this.cars) {
      if (car.isActive()) {
        car.delete(false);
      }
    }
  }

  private activeSourceOrDestination(): boolean {
    return (
      this.stations.length > 1 &&
      this.stations[1].isActive() &&
      this.stations[0].isActive()
    );
  }

  /**
   * Save the tiles the train go through so the cars can reuse them
   * Don't simply save the tiles the engine uses, otherwise the spacing will be dictated by the train speed
   */
  private saveTraversedTiles(from: number, speed: number) {
    if (!this.currentRailroad) {
      return;
    }
    let tileToSave: number = from;
    for (
      let i = 0;
      i < speed && tileToSave < this.currentRailroad.getTiles().length;
      i++
    ) {
      this.saveTile(this.currentRailroad.getTiles()[tileToSave]);
      tileToSave = tileToSave + 1;
    }
  }

  private saveTile(tile: TileRef) {
    this.usedTiles.push(tile);
    if (this.usedTiles.length > this.cars.length * this.spacing + 3) {
      this.usedTiles.shift();
    }
  }

  private updateCarsPositions(newTile: TileRef) {
    if (this.cars.length > 0) {
      for (let i = this.cars.length - 1; i >= 0; --i) {
        const carTileIndex = (i + 1) * this.spacing + 2;
        if (this.usedTiles.length > carTileIndex) {
          this.cars[i].move(this.usedTiles[carTileIndex]);
        }
      }
    }
    if (this.train !== null) {
      this.train.move(newTile);
    }
  }

  private nextStation(): boolean {
    if (this.stations.length > 2) {
      this.pathIndex += this.currentRailroad?.getTiles().length ?? 0;
      this.stations.shift();
      const railRoad =
        getOrientedRailroad(this.stations[0], this.stations[1]) ??
        this.resolveSplitRailroad();
      if (railRoad) {
        this.currentRailroad = railRoad;
        return true;
      }
    }
    return false;
  }

  private resolveSplitRailroad(): OrientedRailroad | null {
    const [station0, station1] = this.stations;
    const path = this.railNetwork.findStationsPath(station0, station1);
    if (!path || path.length <= 2) return null;
    let cursor = this.pathIndex;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = getOrientedRailroad(path[i], path[i + 1]);
      if (!segment) return null;
      for (const tile of segment.getTiles()) {
        if (this.pathTiles[cursor++] !== tile) {
          return null;
        }
      }
    }
    this.stations.splice(0, 2, ...path);
    return getOrientedRailroad(this.stations[0], this.stations[1]);
  }

  private canTradeWithDestination() {
    return (
      this.stations.length > 1 && this.stations[1].tradeAvailable(this.player)
    );
  }

  private getNextTile(): TileRef | null {
    if (this.currentRailroad === null || !this.canTradeWithDestination()) {
      return null;
    }
    this.saveTraversedTiles(this.currentTile, this.speed);
    this.currentTile = this.currentTile + this.speed;
    const leftOver = this.currentTile - this.currentRailroad.getTiles().length;
    if (leftOver >= 0) {
      // Station reached, pick the next station
      this.stationReached();
      if (!this.nextStation()) {
        return null; // Destination reached (or no valid connection)
      }
      this.currentTile = leftOver;
      this.saveTraversedTiles(0, leftOver);
    }
    return this.currentRailroad.getTiles()[this.currentTile];
  }

  private stationReached() {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    this.stations[1].onTrainStop(this);
    const stationType = this.stations[1].unit.type();
    if (stationType === UnitType.City || stationType === UnitType.Port) {
      this._tradeStopsVisited++;
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    if (this.railNetwork !== w.game.railNetwork()) {
      throw new Error("TrainExecution: only the game's rail network is stored");
    }
    const rr = this.currentRailroad?.getState() ?? null;
    return TrainExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      train: w.unitOrNull(this.train),
      cars: this.cars.map((c) => w.unit(c)),
      hasCargo: this.hasCargo,
      currentTile: this.currentTile,
      spacing: this.spacing,
      usedTiles: w.tiles(this.usedTiles),
      stations: this.stations.map((st) => w.station(st)),
      currentRailroad:
        rr === null
          ? null
          : { railroad: w.railroad(rr.railroad), forward: rr.forward },
      speed: this.speed,
      tradeStopsVisited: this._tradeStopsVisited,
      pathTiles: w.tiles(this.pathTiles),
      pathIndex: this.pathIndex,
      player: w.player(this.player),
      source: w.station(this.source),
      destination: w.station(this.destination),
      numCars: this.numCars,
    });
  }

  restoreSnapshot(s: TrainExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.train = r.unitOrNull(s.train);
    this.cars = s.cars.map((i) => r.unit(i));
    this.hasCargo = s.hasCargo;
    this.currentTile = s.currentTile;
    this.spacing = s.spacing;
    this.usedTiles = Array.from(s.usedTiles);
    this.stations = s.stations.map((i) => r.station(i));
    // Railroads are filled before executions, so the constructor can read
    // the railroad's tiles (a forward one shares its array, as when live).
    this.currentRailroad =
      s.currentRailroad === null
        ? null
        : new OrientedRailroad(
            r.railroad(s.currentRailroad.railroad),
            s.currentRailroad.forward,
          );
    this.speed = s.speed;
    this._tradeStopsVisited = s.tradeStopsVisited;
    this.pathTiles = Array.from(s.pathTiles);
    this.pathIndex = s.pathIndex;
    this.railNetwork = r.game.railNetwork();
    this.player = r.player(s.player);
    this.source = r.station(s.source);
    this.destination = r.station(s.destination);
    this.numCars = s.numCars;
  }
}

const TrainExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  train: zRef().nullable(),
  /** Back to front. */
  cars: z.array(zRef()),
  hasCargo: z.boolean(),
  currentTile: zInt(),
  spacing: zInt(),
  usedTiles: zTiles(),
  stations: z.array(zRef()),
  currentRailroad: z
    .object({ railroad: zRef(), forward: z.boolean() })
    .nullable(),
  speed: zInt(),
  tradeStopsVisited: zInt(),
  pathTiles: zTiles(),
  pathIndex: zInt(),
  player: zPlayerRef(),
  source: zRef(),
  destination: zRef(),
  numCars: zInt(),
});
type TrainExecutionState = z.infer<typeof TrainExecutionStateSchema>;

export const TrainExecutionSnapshot = execSnapshotType({
  name: "Train",
  version: 1,
  schema: TrainExecutionStateSchema,
  cls: () => TrainExecution,
});
