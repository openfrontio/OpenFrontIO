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

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private mg: Game,
    private pseudoRandom: number,
    private speed: number = 6,
    private hittingChance: number = 0.75,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinder.Mini(mg, 2000, true, 10);
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
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() == this.SAMMissile.owner()
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
          this.active = false;
          if (this.pseudoRandom < this.hittingChance) {
            this.target.delete();

            this.mg.displayMessage(
              `Missile succesfully intercepted ${this.target.type()}`,
              MessageType.SUCCESS,
              this._owner.id(),
            );
          } else {
            this.mg.displayMessage(
              `Missile failed to intercept ${this.target.type()}`,
              MessageType.ERROR,
              this._owner.id(),
            );
          }
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
