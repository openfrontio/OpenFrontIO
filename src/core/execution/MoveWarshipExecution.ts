import { Execution, Game, Player, PlayerID } from "../game/Game";

const cancelDelay = 2;

export class MoveWarshipExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    public readonly unitId: number,
    public readonly position: number,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const warship = this.mg.units().find((u) => u.id() == this.unitId);
    if (!warship) {
      console.log("MoveWarshipExecution: warship is already dead");
      return;
    }
    warship.setMoveTarget(this.position);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
