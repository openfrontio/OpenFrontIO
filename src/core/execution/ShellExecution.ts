import { Execution, Game, Unit, UnitType } from "../game/Game";
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";

export class ShellExecution implements Execution {
  private pathFinder: AirPathFinder;
  private mg: Game;
  private destroyAtTick: number = -1;

  constructor(private shell: Unit) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = new AirPathFinder(mg, new PseudoRandom(mg.ticks()));
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (
      !this.shell.targetUnit().isActive() ||
      this.shell.targetUnit().owner() == this.shell.owner() ||
      (this.destroyAtTick != -1 && this.mg.ticks() >= this.destroyAtTick)
    ) {
      this.shell.delete(false);
      return;
    }

    if (this.destroyAtTick == -1 && !this.shell.ownerUnit().isActive()) {
      this.destroyAtTick = this.mg.ticks() + this.mg.config().shellLifetime();
    }

    for (let i = 0; i < 3; i++) {
      const result = this.pathFinder.nextTile(
        this.shell.tile(),
        this.shell.targetUnit().tile(),
      );
      if (result === true) {
        this.shell.targetUnit().modifyHealth(-this.effectOnTarget());
        this.shell.delete(false);
        return;
      } else {
        this.shell.move(result);
      }
    }
  }

  private effectOnTarget(): number {
    const baseDamage: number = this.mg.config().unitInfo(UnitType.Shell).damage;
    return baseDamage;
  }

  isActive(): boolean {
    return this.shell.isActive();
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
