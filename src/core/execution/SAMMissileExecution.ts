import { Execution, Game, MessageType, Unit, UnitType } from "../game/Game";
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";

export class SAMMissileExecution implements Execution {
  private pathFinder: AirPathFinder;
  private mg: Game;
  private speed: number = 12;

  constructor(private sam: Unit) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = new AirPathFinder(mg, new PseudoRandom(mg.ticks()));
    this.mg = mg;
  }

  tick(ticks: number): void {
    // Mirv warheads are too fast, and mirv shouldn't be stopped ever
    const nukesWhitelist = [UnitType.AtomBomb, UnitType.HydrogenBomb];
    if (
      !this.sam.targetUnit().isActive() ||
      !this.sam.ownerUnit().isActive() ||
      this.sam.owner() == this.sam.owner() ||
      !nukesWhitelist.includes(this.sam.targetUnit().type())
    ) {
      this.sam.delete(false);
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.nextTile(
        this.sam.tile(),
        this.sam.targetUnit().tile(),
      );
      if (result === true) {
        this.mg.displayMessage(
          `Missile intercepted ${this.sam.targetUnit().type()}`,
          MessageType.SUCCESS,
          this.sam.owner().id(),
        );
        this.sam.targetUnit().delete();
        this.sam.delete(false);
        return;
      } else {
        this.sam.move(result);
      }
    }
  }

  isActive(): boolean {
    return this.sam.isActive();
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
