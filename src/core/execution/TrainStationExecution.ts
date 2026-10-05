import { z } from "zod";
import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TrainStation } from "../game/TrainStation";
import { PseudoRandom } from "../PseudoRandom";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zRandom, zRef } from "../snapshot/SnapshotType";
import { TrainExecution } from "./TrainExecution";

export class TrainStationExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private random: PseudoRandom;
  private station: TrainStation | null = null;
  private numCars: number = 5;
  private lastSpawnTick: number = 0;
  private ticksCooldown: number = 10; // Minimum cooldown between two trains
  constructor(
    private unit: Unit,
    private spawnTrains?: boolean, // If set, the station will spawn trains
  ) {
    this.unit.setTrainStation(true);
  }

  isActive(): boolean {
    return this.active;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.spawnTrains) {
      this.random = new PseudoRandom(mg.ticks());
    }
  }

  tick(ticks: number): void {
    if (this.mg === undefined) {
      throw new Error("Not initialized");
    }
    if (!this.isActive() || this.unit === undefined) {
      return;
    }
    if (this.station === null) {
      // Can't create new executions on init, so it has to be done in the tick
      this.station = new TrainStation(this.mg, this.unit);
      this.mg.railNetwork().connectStation(this.station);
    }
    if (!this.station.isActive()) {
      this.active = false;
      return;
    }
    if (this.spawnTrains) {
      this.spawnTrain(this.station, ticks);
    }
  }

  private shouldSpawnTrain(): boolean {
    const spawnRate = this.mg
      .config()
      .trainSpawnRate(
        this.unit.owner().unitCount(UnitType.Factory),
        this.mg.unitCount(UnitType.Train),
      );
    for (let i = 0; i < this.unit!.level(); i++) {
      if (this.random.chance(spawnRate)) {
        return true;
      }
    }
    return false;
  }

  private spawnTrain(station: TrainStation, currentTick: number) {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (!this.spawnTrains) return;
    if (this.random === undefined) throw new Error("Not initialized");
    if (currentTick < this.lastSpawnTick + this.ticksCooldown) return;
    const cluster = station.getCluster();
    if (cluster === null) {
      return;
    }
    const owner = this.unit.owner();
    if (!cluster.hasAnyTradeDestination(owner)) {
      return;
    }
    if (!this.shouldSpawnTrain()) {
      return;
    }

    // Pick a destination randomly.
    // Could be improved to pick a lucrative trip
    const destination = cluster.randomTradeDestination(owner, this.random);
    if (destination === null) return;
    if (destination === station) return;

    this.mg.addExecution(
      new TrainExecution(
        this.mg.railNetwork(),
        owner,
        station,
        destination,
        this.numCars,
      ),
    );
    this.lastSpawnTick = currentTick;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TrainStationExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      unit: w.unit(this.unit),
      spawnTrains: this.spawnTrains,
      // Only created by init, and only for stations that spawn trains.
      random: this.random === undefined ? null : w.random(this.random),
      station: this.station === null ? null : w.station(this.station),
      numCars: this.numCars,
      lastSpawnTick: this.lastSpawnTick,
      ticksCooldown: this.ticksCooldown,
    });
  }

  restoreSnapshot(s: TrainStationExecState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.unit = r.unit(s.unit);
    this.spawnTrains = s.spawnTrains;
    if (s.random !== null) this.random = r.random(s.random);
    this.station = s.station === null ? null : r.station(s.station);
    this.numCars = s.numCars;
    this.lastSpawnTick = s.lastSpawnTick;
    this.ticksCooldown = s.ticksCooldown;
  }
}

const TrainStationExecStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  unit: zRef(),
  spawnTrains: z.boolean().optional(),
  random: zRandom().nullable(),
  station: zRef().nullable(),
  numCars: zInt(),
  lastSpawnTick: zInt(),
  ticksCooldown: zInt(),
});
type TrainStationExecState = z.infer<typeof TrainStationExecStateSchema>;

export const TrainStationExecutionSnapshot = execSnapshotType({
  name: "TrainStation",
  version: 1,
  schema: TrainStationExecStateSchema,
  cls: () => TrainStationExecution,
});
