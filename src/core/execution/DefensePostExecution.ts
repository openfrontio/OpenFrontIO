import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ShellExecution } from "./ShellExecution";

export class DefensePostExecution implements Execution {
  private mg: Game;
  private post: Unit | null = null;
  private active: boolean = true;

  private target: Unit | null = null;
  private lastShellAttack = 0;

  private alreadySentShell = new Set<Unit>();

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  private shoot() {
    if (this.post === null) return;
    if (this.target === null) return;
    const shellAttackRate = this.mg.config().defensePostShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.post.tile(),
          this.post.owner(),
          this.post,
          this.target,
        ),
      );
      if (!this.target.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.target);
        this.target = null;
        return;
      }
    }
  }

  tick(ticks: number): void {
    if (this.post === null) {
      const spawnTile = this.player.canBuild(UnitType.DefensePost, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build Defense Post");
        this.active = false;
        return;
      }
      this.post = this.player.buildUnit(UnitType.DefensePost, spawnTile, {});
    }
    if (!this.post.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.post.owner()) {
      this.player = this.post.owner();
    }

    if (this.target !== null && !this.target.isActive()) {
      this.target = null;
    }

    // TODO: Reconsider how/if defense posts target ships.
    // const ships = this.mg
    //   .nearbyUnits(
    //     this.post.tile(),
    //     this.mg.config().defensePostTargettingRange(),
    //     [UnitType.TransportShip, UnitType.Warship],
    //   )
    //   .filter(
    //     ({ unit }) =>
    //       this.post !== null &&
    //       unit.owner() !== this.post.owner() &&
    //       !unit.owner().isFriendly(this.post.owner()) &&
    //       !this.alreadySentShell.has(unit),
    //   );
    //
    // this.target =
    //   ships.sort((a, b) => {
    //     const { unit: unitA, distSquared: distA } = a;
    //     const { unit: unitB, distSquared: distB } = b;
    //
    //     // Prioritize TransportShip
    //     if (
    //       unitA.type() === UnitType.TransportShip &&
    //       unitB.type() !== UnitType.TransportShip
    //     )
    //       return -1;
    //     if (
    //       unitA.type() !== UnitType.TransportShip &&
    //       unitB.type() === UnitType.TransportShip
    //     )
    //       return 1;
    //
    //     // If both are the same type, sort by distance (lower `distSquared` means closer)
    //     return distA - distB;
    //   })[0]?.unit ?? null;
    //
    // if (this.target === null || !this.target.isActive()) {
    //   this.target = null;
    //   return;
    // } else {
    //   this.shoot();
    //   return;
    // }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
