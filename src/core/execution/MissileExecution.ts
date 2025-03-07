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

export class MissileExecution implements Execution {
  private active = true;
  private pathFinder: PathFinder;
  private missile: Unit;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private speed: number = 6,
    private hittingChance: number = 0.75,
    private mg: Game,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinder.Mini(mg, 2000, true, 10);
  }

  tick(ticks: number): void {
    if (this.missile == null) {
      this.missile = this._owner.buildUnit(UnitType.Missile, 0, this.spawn);
    }
    if (!this.missile.isActive()) {
      this.active = false;
      return;
    }
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() == this.missile.owner()
    ) {
      this.missile.delete(false);
      this.active = false;
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.nextTile(
        this.missile.tile(),
        this.target.tile(),
        3,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.active = false;
          if (Math.random() < this.hittingChance) {
            this.target.modifyHealth(-this.missile.info().damage);

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
          this.missile.delete(false);
          return;
        case PathFindResultType.NextTile:
          this.missile.move(result.tile);
          break;
        case PathFindResultType.Pending:
          return;
        case PathFindResultType.PathNotFound:
          consolex.log(`Missile ${this.missile} could not find target`);
          this.active = false;
          this.missile.delete(false);
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
