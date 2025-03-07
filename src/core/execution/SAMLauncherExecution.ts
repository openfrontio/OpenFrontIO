import { consolex } from "../Consolex";
import {
  Cell,
  Execution,
  Game,
  Player,
  Unit,
  PlayerID,
  UnitType,
} from "../game/Game";
import { manhattanDistFN, TileRef } from "../game/GameMap";
import { MissileExecution } from "./MissileExecution";

export class SAMLauncherExecution implements Execution {
  private player: Player;
  private mg: Game;
  private post: Unit;
  private active: boolean = true;

  private target: Unit = null;

  private searchRange = 100;

  private missileAttackRate = 50;
  private lastMissileAttack = 0;
  private missileSpeed = 6;
  private missileHitChance = 0.75;

  private alreadySentMissile = new Set<Unit>();

  constructor(
    private ownerId: PlayerID,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.ownerId)) {
      console.warn(`SAMLauncherExecution: owner ${this.ownerId} not found`);
      this.active = false;
      return;
    }
    this.player = mg.player(this.ownerId);
  }

  tick(ticks: number): void {
    if (this.post == null) {
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile == false) {
        consolex.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.post = this.player.buildUnit(UnitType.SAMLauncher, 0, spawnTile);
    }
    if (!this.post.isActive()) {
      this.active = false;
      return;
    }

    const nukes = this.mg
      .units(UnitType.AtomBomb, UnitType.HydrogenBomb)
      .filter(
        (u) =>
          this.mg.manhattanDist(u.tile(), this.post.tile()) < this.searchRange,
      )
      .filter((u) => u.owner() !== this.player)
      .filter((u) => !u.owner().isAlliedWith(this.player));

    this.target =
      nukes.sort((a, b) => {
        // Prioritize HydrogenBombs first
        if (
          a.type() === UnitType.HydrogenBomb &&
          b.type() !== UnitType.HydrogenBomb
        ) {
          return -1;
        }
        if (
          a.type() !== UnitType.HydrogenBomb &&
          b.type() === UnitType.HydrogenBomb
        ) {
          return 1;
        }
        // If both are the same type, sort by distance
        return (
          this.mg.manhattanDist(this.post.tile(), a.tile()) -
          this.mg.manhattanDist(this.post.tile(), b.tile())
        );
      })[0] ?? null;

    if (this.target != null) {
      if (this.mg.ticks() - this.lastMissileAttack > this.missileAttackRate) {
        this.lastMissileAttack = this.mg.ticks();
        this.mg.addExecution(
          new MissileExecution(
            this.post.tile(),
            this.post.owner(),
            this.post,
            this.target,
            this.missileSpeed,
            this.missileHitChance,
            this.mg,
          ),
        );
      }
      if (!this.target.hasHealth()) {
        this.alreadySentMissile.add(this.target);
        this.target = null;
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
