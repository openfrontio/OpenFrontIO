import { Execution, Game, Unit } from "../game/Game";
import { TrainStation } from "../game/TrainStation";
import { PseudoRandom } from "../PseudoRandom";
import { TrainExecution } from "./TrainExecution";

export class TrainStationExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private random: PseudoRandom;
  private station: TrainStation | null = null;
  private numCars: number = 5;
  private nextSpawnTick = 0;
  constructor(
    private unit: Unit,
    private spawnTrains?: boolean, // If set, the station will spawn trains
    private passive?: boolean, // Registered without originating any rails
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
      this.nextSpawnTick = ticks + mg.config().trainSpawnIntervalTicks();
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
      if (this.passive) {
        this.mg.railNetwork().registerPassiveStation(this.station);
      } else {
        this.mg.railNetwork().connectStation(this.station);
      }
    }
    if (!this.station.isActive()) {
      this.active = false;
      return;
    }
    if (this.spawnTrains) {
      this.spawnTrain(this.station, ticks);
    }
  }

  private spawnTrain(station: TrainStation, currentTick: number) {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (!this.spawnTrains) return;
    if (this.random === undefined) throw new Error("Not initialized");
    if (currentTick < this.nextSpawnTick) return;
    const cluster = station.getCluster();
    if (cluster === null) {
      return;
    }
    const owner = this.unit.owner();
    if (!cluster.hasAnyTradeDestination(owner)) {
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
    this.nextSpawnTick =
      currentTick + this.mg.config().trainSpawnIntervalTicks();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
