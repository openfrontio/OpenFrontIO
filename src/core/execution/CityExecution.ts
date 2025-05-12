import { Execution, Game, Unit } from "../game/Game";

export class CityExecution implements Execution {
  constructor(private city: Unit) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.city.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
