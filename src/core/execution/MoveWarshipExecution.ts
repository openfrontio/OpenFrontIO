import { Execution, Game } from "../game/Game";

const cancelDelay = 2;

export class MoveWarshipExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(
    public readonly unitId: number,
    public readonly position: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null) {
      throw new Error("Not initialized");
    }
    const warship = this.mg.units().find((u) => u.id() === this.unitId);
    if (!warship) {
      console.log("MoveWarshipExecution: warship is already dead");
      return;
    }
    warship.setTargetTile(this.position);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
