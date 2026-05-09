import { Execution, Game, Unit, UnitType } from "../game/Game";
import { consumeFuel, fuelBonus } from "../game/Fuel";
import { TrainStationExecution } from "./TrainStationExecution";

export class MissileSiloExecution implements Execution {
  private active = true;
  private mg: Game;
  private silo: Unit;
  private stationCreated = false;

  constructor(silo: Unit) {
    this.silo = silo;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.silo.isUnderConstruction()) {
      return;
    }

    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }

    if (!this.silo.isActive()) {
      this.active = false;
      return;
    }

    consumeFuel(this.mg.config(), this.silo);

    // frontTime is the time the earliest missile fired.
    const frontTime = this.silo.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }

    const cooldownDuration =
      this.mg.config().SiloCooldown() *
      (1 - fuelBonus(this.mg.config(), this.silo));
    const cooldown = cooldownDuration - (this.mg.ticks() - frontTime);

    if (cooldown <= 0) {
      this.silo.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private createStation(): void {
    const nearbyFactory = this.mg.hasUnitNearby(
      this.silo.tile(),
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.silo));
    }
  }
}
