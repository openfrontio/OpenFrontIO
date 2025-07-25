import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

type Target = {
  unit: Unit;
  tile: TileRef;
};

type ReachableTile = {
  tile: TileRef;
  tick: number; // When tile will be reachable
};
export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private MIRVWarheadSearchRadius = 400;
  private MIRVWarheadProtectionRadius = 50;

  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private player: Player,
    private tile: TileRef | null,
    private sam: Unit | null = null,
  ) {
    if (sam !== null) {
      this.tile = sam.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  private isInRange(tile: TileRef) {
    const samTile = this.sam!.tile();
    const rangeSquared = this.mg.config().defaultSamRange() ** 2;
    return this.mg.euclideanDistSquared(samTile, tile) <= rangeSquared;
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    const missileSpeed = this.mg.config().defaultSamMissileSpeed();
    const manhattanDist = this.mg.manhattanDist(currentTile, tile);
    return Math.ceil(manhattanDist / missileSpeed);
  }

  private fastestReachableTile(unit: Unit): ReachableTile | undefined {
    const trajectory = unit.trajectory();
    const samTile = this.sam!.tile();
    const currentIndex = unit.trajectoryIndex();
    const explosionTime: number = trajectory.length - currentIndex; // Time left before explosion
    for (let i = unit.trajectoryIndex(); i < trajectory.length; i++) {
      const trajectoryTile = trajectory[i];
      if (trajectoryTile.targetable && this.isInRange(trajectoryTile.tile)) {
        const whenReachable = i - currentIndex;
        const tickToReach = this.tickToReach(samTile, trajectoryTile.tile);
        const reachableOnTime: boolean =
          Math.abs(whenReachable - tickToReach) <= 1;
        if (reachableOnTime && tickToReach < explosionTime) {
          return { tile: trajectoryTile.tile, tick: whenReachable };
        }
      }
    }
    return undefined;
  }

  private getSingleTarget(ticks: number): Target | null {
    if (this.sam === null) return null;
    const nukes = this.mg.nearbyUnits(
      this.sam.tile(),
      this.mg.config().defaultSamRange() * 2, // Double the SAM range when retrieving the nearby nukes so it can preshot them
      [UnitType.AtomBomb, UnitType.HydrogenBomb],
      ({ unit }) => {
        return (
          unit.owner() !== this.player && !this.player.isFriendly(unit.owner())
        );
      },
    );

    const targets: Array<Target> = [];
    for (const nuke of nukes) {
      const fastestTile = this.fastestReachableTile(nuke.unit);
      if (fastestTile !== undefined) {
        targets.push({ unit: nuke.unit, tile: fastestTile.tile });
      }
    }
    console.log("Target size: ", targets.length);

    return (
      targets.sort((a: Target, b: Target) => {
        // Prioritize Hydrogen Bombs
        if (
          a.unit.type() === UnitType.HydrogenBomb &&
          b.unit.type() !== UnitType.HydrogenBomb
        )
          return -1;
        if (
          a.unit.type() !== UnitType.HydrogenBomb &&
          b.unit.type() === UnitType.HydrogenBomb
        )
          return 1;

        return 1;
      })[0] ?? null
    );
  }

  private isHit(type: UnitType, random: number): boolean {
    if (type === UnitType.AtomBomb) {
      return true;
    }

    if (type === UnitType.MIRVWarhead) {
      return random < this.mg.config().samWarheadHittingChance();
    }

    return random < this.mg.config().samHittingChance();
  }

  tick(ticks: number): void {
    if (this.mg === null || this.player === null) {
      throw new Error("Not initialized");
    }
    if (this.sam === null) {
      if (this.tile === null) {
        throw new Error("tile is null");
      }
      const spawnTile = this.player.canBuild(UnitType.SAMLauncher, this.tile);
      if (spawnTile === false) {
        console.warn("cannot build SAM Launcher");
        this.active = false;
        return;
      }
      this.sam = this.player.buildUnit(UnitType.SAMLauncher, spawnTile, {});
    }
    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.sam.owner()) {
      this.player = this.sam.owner();
    }

    this.pseudoRandom ??= new PseudoRandom(this.sam.id());

    const mirvWarheadTargets = this.mg.nearbyUnits(
      this.sam.tile(),
      this.MIRVWarheadSearchRadius,
      UnitType.MIRVWarhead,
      ({ unit }) => {
        if (unit.owner() === this.player) return false;
        if (this.player.isFriendly(unit.owner())) return false;
        const dst = unit.targetTile();
        return (
          this.sam !== null &&
          dst !== undefined &&
          this.mg.manhattanDist(dst, this.sam.tile()) <
            this.MIRVWarheadProtectionRadius
        );
      },
    );

    let target: Target | null = null;
    if (mirvWarheadTargets.length === 0) {
      target = this.getSingleTarget(ticks);
    }

    const isSingleTarget = target && !target.unit.targetedBySAM();
    if (
      (isSingleTarget || mirvWarheadTargets.length > 0) &&
      !this.sam.isInCooldown()
    ) {
      this.sam.launch();
      const type =
        mirvWarheadTargets.length > 0
          ? UnitType.MIRVWarhead
          : target?.unit.type();
      if (type === undefined) throw new Error("Unknown unit type");
      const random = this.pseudoRandom.next();
      const hit = this.isHit(type, random);
      if (!hit) {
        this.mg.displayMessage(
          `Missile failed to intercept ${type}`,
          MessageType.SAM_MISS,
          this.sam.owner().id(),
        );
      } else if (mirvWarheadTargets.length > 0) {
        const samOwner = this.sam.owner();

        // Message
        this.mg.displayMessage(
          `${mirvWarheadTargets.length} MIRV warheads intercepted`,
          MessageType.SAM_HIT,
          samOwner.id(),
        );

        mirvWarheadTargets.forEach(({ unit: u }) => {
          // Delete warheads
          u.delete();
        });

        // Record stats
        this.mg
          .stats()
          .bombIntercept(
            samOwner,
            UnitType.MIRVWarhead,
            mirvWarheadTargets.length,
          );
      } else if (target !== null) {
        target.unit.setTargetedBySAM(true);
        this.mg.addExecution(
          new SAMMissileExecution(
            this.sam.tile(),
            this.sam.owner(),
            this.sam,
            target.unit,
            target.tile,
          ),
        );
      } else {
        throw new Error("target is null");
      }
    }

    const frontTime = this.sam.missileTimerQueue()[0];
    if (frontTime === undefined) {
      return;
    }

    const cooldown =
      this.mg.config().SAMCooldown() - (this.mg.ticks() - frontTime);

    if (cooldown <= 0) {
      this.sam.reloadMissile();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
