import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TrainExecution } from "./TrainExecution";
import { TrainStationExecution } from "./TrainStationExecution";

export class OilRigExecution implements Execution {
  private active = true;
  private mg!: Game;
  private checkOffset = 0;

  constructor(private oilRig: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.checkOffset =
      mg.ticks() % Math.max(1, mg.config().oilRigIncomeInterval());
  }

  tick(ticks: number): void {
    if (!this.oilRig.isActive()) {
      this.active = false;
      return;
    }

    if (this.oilRig.isUnderConstruction()) {
      return;
    }

    if (!this.oilRig.hasTrainStation()) {
      this.createStation();
    }

    if (!this.shouldSpawnFreightTrain(ticks)) {
      return;
    }

    this.spawnFreightTrain(ticks);
  }

  private shouldSpawnFreightTrain(ticks: number): boolean {
    const interval = Math.max(1, this.mg.config().oilRigIncomeInterval());
    void ticks;
    return (this.mg.ticks() + this.checkOffset) % interval === 0;
  }

  private spawnFreightTrain(ticks: number): void {
    void ticks;

    const sourceStation = this.mg
      .railNetwork()
      .stationManager()
      .findStation(this.oilRig);
    if (!sourceStation) {
      return;
    }

    const cluster = sourceStation.getCluster();
    if (!cluster) {
      return;
    }

    const destination = cluster.nearestOwnedFactory(
      sourceStation,
      this.oilRig.owner(),
    );
    if (!destination) {
      return;
    }

    this.mg.addExecution(
      new TrainExecution(
        this.mg.railNetwork(),
        this.oilRig.owner(),
        sourceStation,
        destination,
        5,
        "freight",
      ),
    );
  }

  private createStation(): void {
    const nearbyFactory = this.mg.hasUnitNearby(
      this.oilRig.tile(),
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.oilRig));
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
