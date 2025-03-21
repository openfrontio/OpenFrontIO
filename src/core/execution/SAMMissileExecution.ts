import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { PathFinder } from "../pathfinding/PathFinding";
import { PathFindResultType } from "../pathfinding/AStar";
import { consolex } from "../Consolex";
import { TileRef } from "../game/GameMap";

export class SAMMissileExecution implements Execution {
  private active = true;
  private pathFinder: PathFinder;
  private SAMMissile: Unit;
  private mg: Game;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private speed: number = 12,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinder.Mini(mg, 2000, true, 10);
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.SAMMissile == null) {
      this.SAMMissile = this._owner.buildUnit(
        UnitType.SAMMissile,
        0,
        this.spawn,
      );
    }
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }
    // Mirv warheads are too fast, and mirv shouldn't be stopped ever
    const nukesWhitelist = [UnitType.AtomBomb, UnitType.HydrogenBomb];
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() == this.SAMMissile.owner() ||
      !nukesWhitelist.includes(this.target.type())
    ) {
      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.nextTile(
        this.SAMMissile.tile(),
        this.target.tile(),
        3,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.mg.displayMessage(
            `Missile intercepted ${this.target.type()}`,
            MessageType.SUCCESS,
            this._owner.id(),
          );
          this.active = false;
          this.target.delete();
          this.SAMMissile.delete(false);
          return;
        case PathFindResultType.NextTile:
          this.SAMMissile.move(result.tile);
          break;
        case PathFindResultType.Pending:
          return;
        case PathFindResultType.PathNotFound:
          consolex.log(`Missile ${this.SAMMissile} could not find target`);
          this.active = false;
          this.SAMMissile.delete(false);
          return;
      }
    }
  }

  owner(): Player {
    return null;
  }
  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
