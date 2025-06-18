import { Execution, Game, Player, Unit } from "../game/Game";
import { TrainStation } from "../game/TrainStation";
import { PseudoRandom } from "../PseudoRandom";
import { TrainExecution } from "./TrainExecution";

export class TrainStationExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  private random: PseudoRandom | null = null;
  private station: TrainStation | null = null;
  private unit: Unit | undefined = undefined;
  private numCars: number = 5;
  constructor(
    private player: Player,
    private unitId: number,
  ) {}

  isActive(): boolean {
    return this.active;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    this.unit = this.player.units().find((unit) => unit.id() === this.unitId);
    if (this.unit === undefined) {
      console.warn(`station unit is undefined`);
      this.active = false;
      return;
    }
    this.unit.setTrainStation(true);
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
    if (!this.station.isActive() || !this.random) {
      this.active = false;
      return;
    }
    const cluster = this.station.getCluster();
    if (cluster === null) {
      return;
    }
    const availableForTrade = cluster.availableForTrade(this.unit.owner());
    if (
      availableForTrade.size === 0 ||
      !this.random.chance(
        this.mg.config().trainSpawnRate(availableForTrade.size),
      )
    ) {
      return;
    }
    // Pick a destination randomly.
    // Could be improved to pick a lucrative trip
    const destination = this.random.randFromSet(availableForTrade);
    if (destination !== this.station) {
      this.mg.addExecution(
        new TrainExecution(
          this.mg.railNetwork(),
          this.unit.owner(),
          this.station,
          destination,
          this.numCars,
        ),
      );
    }
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
