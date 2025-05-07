import { Execution, Game, Unit } from "../game/Game";

export class MissileSiloExecution implements Execution {
  private mg: Game;

  constructor(private silo: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (
      this.silo.isCooldown() &&
      this.silo.ticksLeftInCooldown(this.mg.config().SiloCooldown()) == 0
    ) {
      this.silo.setCooldown(false);
    }
  }

  isActive(): boolean {
    return this.silo.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
