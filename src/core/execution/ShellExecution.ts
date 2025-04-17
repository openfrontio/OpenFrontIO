import { consolex } from "../Consolex";
import { Execution, Game, Player, Speed, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";

export class ShellExecution implements Execution {
  private active = true;
  private pathFinder: PathFinder;
  private shell: Unit;
  private mg: Game;
  private destroyAtTick: number = -1;
  private speed: Speed;
  private damage: number;
  private damageVariation: number;
  private lifetime: number;
  private atTargetDist: number;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinder.Mini(mg, 2000, true, 10);
    this.mg = mg;
    this.damage = this.mg.config().unitInfo(UnitType.Shell).damage;
    this.damageVariation = this.mg
      .config()
      .unitInfo(UnitType.Shell).damageVariation;
    this.speed = this.mg.config().unitInfo(UnitType.Shell).speed;
    this.lifetime = this.mg.config().unitInfo(UnitType.Shell).maxHealth;
    this.atTargetDist = this.mg.config().unitInfo(UnitType.Shell).atTargetDist;
  }

  tick(ticks: number): void {
    if (this.shell == null) {
      this.shell = this._owner.buildUnit(UnitType.Shell, 0, this.spawn);
    }
    if (!this.shell.isActive()) {
      this.active = false;
      return;
    }
    if (this.destroyAtTick == -1) {
      this.destroyAtTick = this.mg.ticks() + this.lifetime;
    }

    if (
      !this.target.isActive() ||
      this.target.owner() == this.shell.owner() ||
      this.mg.ticks() >= this.destroyAtTick
    ) {
      this.shell.delete(false);
      this.active = false;
      return;
    }

    const moveResult: PathFindResultType | null = this.moveDuringTick();

    switch (moveResult) {
      case PathFindResultType.Completed:
        this.active = false;
        this.target.modifyHealth(-this.effectOnTarget(ticks));
        this.shell.delete(false);
        break;
      case PathFindResultType.PathNotFound:
        consolex.log(`Shell ${this.shell} could not find target`);
        this.active = false;
        this.shell.delete(false);
    }
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private moveDuringTick(): PathFindResultType | null {
    for (let i = 0; i < this.speed.tilesPerTick; i++) {
      const result = this.pathFinder.nextTile(
        this.shell.tile(),
        this.target.tile(),
        this.atTargetDist,
      );
      switch (result.type) {
        case PathFindResultType.NextTile:
          this.shell.move(result.tile);
          break;
        case PathFindResultType.Pending:
          return;
        case PathFindResultType.Completed:
        case PathFindResultType.PathNotFound:
          return result.type;
      }
    }
  }

  private effectOnTarget(ticks: number): number {
    const baseDamage: number = this.damage;
    const damageMod: number = this.damageVariation;
    const pseudoRandom = new PseudoRandom(ticks);
    switch (pseudoRandom.nextInt(1, 6)) {
      case 1:
        return baseDamage - damageMod * 2;
      case 2:
        return baseDamage - damageMod;
      case 3:
        return baseDamage;
      case 4:
        return baseDamage + damageMod;
      case 5:
        return baseDamage + damageMod * 2;
    }
  }
}
