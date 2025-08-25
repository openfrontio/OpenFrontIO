import {
  Execution,
  Game,
  isUnit,
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

/**
 * Smart SAM targeting system preshoting nukes so its range is strictly enforced
 */
class SAMTargetingSystem {
  // Store unreachable nukes so the SAM won't compute an interception point for them every frame
  private readonly nukesToIgnore: Set<number> = new Set();

  constructor(
    private readonly mg: Game,
    private readonly sam: Unit,
  ) {}

  updateUnreachableNukes(nearbyUnits: { unit: Unit; distSquared: number }[]) {
    const nearbyUnitSet = new Set(nearbyUnits.map((u) => u.unit.id()));
    for (const nukeId of this.nukesToIgnore) {
      if (!nearbyUnitSet.has(nukeId)) {
        this.nukesToIgnore.delete(nukeId);
      }
    }
  }

  private storeUnreachableNukes(nukeId: number) {
    this.nukesToIgnore.add(nukeId);
  }

  private isInRange(tile: TileRef) {
    const samTile = this.sam.tile();
    const rangeSquared = this.mg.config().defaultSamRange() ** 2;
    return this.mg.euclideanDistSquared(samTile, tile) <= rangeSquared;
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    const missileSpeed = this.mg.config().defaultSamMissileSpeed();
    return Math.ceil(this.mg.manhattanDist(currentTile, tile) / missileSpeed);
  }

  private computeInterceptionTile(unit: Unit): TileRef | undefined {
    const trajectory = unit.trajectory();
    const samTile = this.sam.tile();
    const currentIndex = unit.trajectoryIndex();
    const explosionTick: number = trajectory.length - currentIndex;
    for (let i = unit.trajectoryIndex(); i < trajectory.length; i++) {
      const trajectoryTile = trajectory[i];
      if (trajectoryTile.targetable && this.isInRange(trajectoryTile.tile)) {
        const nukeTickToReach = i - currentIndex;
        const samTickToReach = this.tickToReach(samTile, trajectoryTile.tile);
        const reachableOnTime = Math.abs(nukeTickToReach - samTickToReach) <= 1;
        if (reachableOnTime && samTickToReach < explosionTick) {
          return trajectoryTile.tile;
        }
      }
    }
    return undefined;
  }

  public getSingleTarget(): Target | null {
    // Look beyond the SAM range so it can preshot nukes
    const detectionRange = this.mg.config().defaultSamRange() * 1.5;
    const nukes = this.mg.nearbyUnits(
      this.sam.tile(),
      detectionRange,
      [UnitType.AtomBomb, UnitType.HydrogenBomb],
      ({ unit }) => {
        return (
          isUnit(unit) &&
          unit.owner() !== this.sam.owner() &&
          !this.sam.owner().isFriendly(unit.owner())
        );
      },
    );

    // Clear unreachable nukes that went out of range
    this.updateUnreachableNukes(nukes);

    const targets: Array<Target> = [];
    for (const nuke of nukes) {
      if (this.nukesToIgnore.has(nuke.unit.id())) {
        continue;
      }
      const interceptionTile = this.computeInterceptionTile(nuke.unit);
      if (interceptionTile !== undefined) {
        targets.push({ tile: interceptionTile, unit: nuke.unit });
      } else {
        // Store unreachable nukes in order to prevent useless interception computation
        this.storeUnreachableNukes(nuke.unit.id());
      }
    }

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

        return 0;
      })[0] ?? null
    );
  }
}

export class SAMLauncherExecution implements Execution {
  private mg: Game | undefined;
  private active = true;

  // As MIRV go very fast we have to detect them very early but we only
  // shoot the one targeting very close (MIRVWarheadProtectionRadius)
  private readonly MIRVWarheadSearchRadius = 400;
  private readonly MIRVWarheadProtectionRadius = 50;
  private targetingSystem: SAMTargetingSystem | undefined;

  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private player: Player,
    private readonly tile: TileRef | null,
    private sam: Unit | null = null,
  ) {
    if (sam !== null) {
      this.tile = sam.tile();
    }
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  private isHit(type: UnitType, random: number): boolean {
    if (type === UnitType.AtomBomb) {
      return true;
    }

    if (this.mg === undefined) throw new Error("Not initialized");
    if (type === UnitType.MIRVWarhead) {
      return random < this.mg.config().samWarheadHittingChance();
    }

    return random < this.mg.config().samHittingChance();
  }

  tick(ticks: number): void {
    if (this.mg === undefined) throw new Error("Not initialized");
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
    this.targetingSystem ??= new SAMTargetingSystem(this.mg, this.sam);

    if (this.sam.isInCooldown()) {
      const frontTime = this.sam.missileTimerQueue()[0];
      if (frontTime === undefined) {
        return;
      }
      const cooldown =
        this.mg.config().SAMCooldown() - (this.mg.ticks() - frontTime);

      if (cooldown <= 0) {
        this.sam.reloadMissile();
      }
      return;
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
        if (this.mg === undefined) return false;
        if (!isUnit(unit)) return false;
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
      target = this.targetingSystem.getSingleTarget();
    }

    const isSingleTarget = target && !target.unit.targetedBySAM();
    if (isSingleTarget || mirvWarheadTargets.length > 0) {
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
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
