import { consolex } from "../Consolex";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";

export class ShellExecution implements Execution {
  private active = true;
  private pathFinder: PathFinder;
  private shell: Unit;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinder.Mini(mg, 2000, true, 10);
  }

  tick(ticks: number): void {
    if (this.shell == null) {
      this.shell = this._owner.buildUnit(UnitType.Shell, 0, this.spawn);
    }
    if (!this.shell.isActive()) {
      this.active = false;
      return;
    }
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() == this.shell.owner()
    ) {
      this.shell.delete(false);
      this.active = false;
      return;
    }
    for (let i = 0; i < 3; i++) {
      const result = this.pathFinder.nextTile(
        this.shell.tile(),
        this.target.tile(),
        3,
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          this.active = false;
          this.target.modifyHealth(-this.shell.info().damage);
          this.shell.delete(false);
          return;
        case PathFindResultType.NextTile:
          this.shell.move(result.tile);
          break;
        case PathFindResultType.Pending:
          return;
        case PathFindResultType.PathNotFound:
          consolex.log(`Shell ${this.shell} could not find target`);
          this.active = false;
          this.shell.delete(false);
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
