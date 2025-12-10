import { Execution, Game, Player, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AirPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";

export class SAMMissileExecution implements Execution {
  private active = true;
  private pathFinder: AirPathFinder;
  private SAMMissile: Unit | undefined;
  private mg: Game;
  private speed: number = 0;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = new AirPathFinder(mg, new PseudoRandom(mg.ticks()));
    this.mg = mg;
    this.speed = this.mg.config().defaultSamMissileSpeed();
  }

  tick(ticks: number): void {
    this.SAMMissile ??= this._owner.buildUnit("SAM Missile", this.spawn, {});
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }
    // Mirv warheads are too fast, and mirv shouldn't be stopped ever
    const nukesWhitelist = ["Atom Bomb", "Hydrogen Bomb"];
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() === this.SAMMissile.owner() ||
      !nukesWhitelist.includes(this.target.type())
    ) {
      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.nextTile(
        this.SAMMissile.tile(),
        this.targetTile,
      );
      if (result === true) {
        this.mg.displayMessage(
          `Missile intercepted ${this.target.type()}`,
          "SAM_HIT",
          this._owner.id(),
        );
        this.active = false;
        this.target.delete(true, this._owner);
        this.SAMMissile.delete(false);

        // Record stats
        this.mg
          .stats()
          .bombIntercept(this._owner, this.target.type() as NukeType, 1);
        return;
      } else {
        this.SAMMissile.move(result);
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
