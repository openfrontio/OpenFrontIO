import { Execution, Game, MessageType, Unit, UnitType } from "../game/Game";
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";

export class SAMMissileExecution implements Execution {
  private pathFinder: AirPathFinder;
  private mg: Game;

  constructor(private missile: Unit) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = new AirPathFinder(mg, new PseudoRandom(mg.ticks()));
    this.mg = mg;
  }

  tick(ticks: number): void {
    // Mirv warheads are too fast, and mirv shouldn't be stopped ever
    const nukesWhitelist = [UnitType.AtomBomb, UnitType.HydrogenBomb];
    if (
      !this.target.isActive() ||
      !this.missile.isActive() ||
      this.target.owner() == this.missile.owner() ||
      !nukesWhitelist.includes(this.target.type())
    ) {
      this.missile.delete(false);
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.nextTile(
        this.missile.tile(),
        this.target.tile(),
      );
      if (result === true) {
        this.mg.displayMessage(
          `Missile intercepted ${this.target.type()}`,
          MessageType.SUCCESS,
          this.missile.owner().id(),
        );
        this.target.delete();
        this.missile.delete(false);
        return;
      } else {
        this.missile.move(result);
      }
    }
  }

  isActive(): boolean {
    return this.missile.isActive();
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
