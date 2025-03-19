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
import { SAMMissileExecution } from "./SAMMissileExecution";
import { PseudoRandom } from "../PseudoRandom";

export class SAMLauncherExecution implements Execution {
  private player: Player;
  private mg: Game;
  private post: Unit;
  private active: boolean = true;

  private target: Unit = null;

  private searchRangeRadius = 75;

  private missileAttackRate = 75; // 7.5 seconds
  private lastMissileAttack = 0;

  private pseudoRandom: PseudoRandom;

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

    if (!this.pseudoRandom) {
      this.pseudoRandom = new PseudoRandom(this.post.id());
    }

    const nukes = this.mg
      .units(UnitType.AtomBomb, UnitType.HydrogenBomb)
      .filter((u) => {
        // (x - center_x)² + (y - center_y)² < radius²
        const x = this.mg.x(u.tile());
        const y = this.mg.y(u.tile());
        const centerX = this.mg.x(this.post.tile());
        const centerY = this.mg.y(this.post.tile());
        const isInRange =
          (x - centerX) ** 2 + (y - centerY) ** 2 < this.searchRangeRadius ** 2;
        return isInRange;
      })
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

    const cooldown =
      this.lastMissileAttack != 0 &&
      this.mg.ticks() - this.lastMissileAttack <= this.missileAttackRate;
    if (this.post.isSamCooldown() != cooldown) {
      this.post.setSamCooldown(cooldown);
    }

    if (this.target != null) {
      if (!this.post.isSamCooldown()) {
        this.lastMissileAttack = this.mg.ticks();
        this.mg.addExecution(
          new SAMMissileExecution(
            this.post.tile(),
            this.post.owner(),
            this.post,
            this.target,
            this.mg,
            this.pseudoRandom.next(),
          ),
        );
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
