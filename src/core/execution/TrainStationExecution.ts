import { Execution, Game, Unit } from "../game/Game";
import { TrainStation } from "../game/TrainStation";
import { PseudoRandom } from "../PseudoRandom";
import { TrainExecution } from "./TrainExecution";

export class TrainStationExecution implements Execution {
  private mg: Game | undefined;
  private active = true;
  private random: PseudoRandom | undefined;
  private station: TrainStation | null = null;
  private readonly numCars = 5;
  private lastSpawnTick = 0;
  private readonly ticksCooldown = 10; // Minimum cooldown between two trains
  constructor(
    private readonly unit: Unit,
    private readonly spawnTrains?: boolean, // If set, the station will spawn trains
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
    this.spawnTrain(this.station, ticks);
  }

  private shouldSpawnTrain(clusterSize: number): boolean {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.random === undefined) throw new Error("Not initialized");
    const spawnRate = this.mg.config().trainSpawnRate(clusterSize);
    for (let i = 0; i < this.unit.level(); i++) {
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
    const availableForTrade = cluster.availableForTrade(this.unit.owner());
    if (availableForTrade.size === 0) {
      return;
    }
    if (!this.shouldSpawnTrain(availableForTrade.size)) {
      return;
    }

    // Pick a destination randomly.
    // Could be improved to pick a lucrative trip
    const destination: TrainStation =
      this.random.randFromSet(availableForTrade);
    if (destination !== station) {
      this.mg.addExecution(
        new TrainExecution(
          this.mg.railNetwork(),
          this.unit.owner(),
          station,
          destination,
          this.numCars,
        ),
      );
      this.lastSpawnTick = currentTick;
    }
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
