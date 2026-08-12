import { Execution, Game, isUnit, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

type Target = {
  unit: Unit;
  tile: TileRef;
};

type InterceptionTile = {
  tile: TileRef;
  tick: number;
};

/**
 * Smart SAM targeting system preshoting nukes so its range is strictly enforced
 */
class SAMTargetingSystem {
  // Interception tiles are computed a single time, but it may not be reachable yet.
  // Store the result so it can be intercepted at the proper time, rather than recomputing each tick.
  // Null interception tile means there are no interception tiles in range. Store it to avoid recomputing.
  private readonly precomputedNukes: Map<number, InterceptionTile | null> =
    new Map();
  private readonly missileSpeed: number;

  constructor(
    private readonly mg: Game,
    private readonly sam: Unit,
  ) {
    this.missileSpeed = this.mg.config().defaultSamMissileSpeed();
  }

  updateUnreachableNukes(nearbyUnits: { unit: Unit; distSquared: number }[]) {
    if (this.precomputedNukes.size === 0) {
      return;
    }

    // Avoid per-tick allocations for the common case where only a few nukes are tracked.
    if (this.precomputedNukes.size <= 16) {
      for (const nukeId of this.precomputedNukes.keys()) {
        let found = false;
        for (const u of nearbyUnits) {
          if (u.unit.id() === nukeId) {
            found = true;
            break;
          }
        }
        if (!found) {
          this.precomputedNukes.delete(nukeId);
        }
      }
      return;
    }

    const nearbyUnitSet = new Set<number>();
    for (const u of nearbyUnits) {
      nearbyUnitSet.add(u.unit.id());
    }
    for (const nukeId of this.precomputedNukes.keys()) {
      if (!nearbyUnitSet.has(nukeId)) {
        this.precomputedNukes.delete(nukeId);
      }
    }
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    return Math.ceil(
      this.mg.manhattanDist(currentTile, tile) / this.missileSpeed,
    );
  }

  private computeInterceptionTile(
    unit: Unit,
    samTile: TileRef,
    rangeSquared: number,
  ): InterceptionTile | undefined {
    const trajectory = unit.trajectory();
    const currentIndex = unit.trajectoryIndex();
    const waitTicks = unit.nukeState().waitTicks ?? 0;
    // NukeExecution happens before SAMMissileExecution. It cannot intercept the final tick.
    const maxInterceptionIndex = trajectory.length - 2;
    for (let i = currentIndex; i <= maxInterceptionIndex; i++) {
      const trajectoryTile = trajectory[i];
      if (
        trajectoryTile.targetable &&
        this.mg.euclideanDistSquared(samTile, trajectoryTile.tile) <=
          rangeSquared
      ) {
        const nukeTickToReach = i - currentIndex + waitTicks;
        const samTickToReach = this.tickToReach(samTile, trajectoryTile.tile);
        const tickBeforeShooting = nukeTickToReach - samTickToReach;
        if (tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: trajectoryTile.tile };
        }
      }
    }

    // No interception found; check if detonation tile inside SAM range
    const finalExplosionTile = trajectory[trajectory.length - 1];
    if (
      finalExplosionTile &&
      finalExplosionTile.targetable &&
      this.mg.euclideanDistSquared(samTile, finalExplosionTile.tile) <=
        rangeSquared
    ) {
      const targetInFlightTile = trajectory[maxInterceptionIndex];
      if (targetInFlightTile && targetInFlightTile.targetable) {
        const nukeTickToReach = maxInterceptionIndex - currentIndex + waitTicks;
        const samTickToReach = this.tickToReach(
          samTile,
          targetInFlightTile.tile,
        );
        const tickBeforeShooting = nukeTickToReach - samTickToReach;
        // can we shoot the nuke the tick before it explodes?
        if (tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: targetInFlightTile.tile };
        }
      }
    }

    return undefined;
  }

  private computeTargetScore(target: Target): number {
    const samTile = this.sam.tile();
    const unit = target.unit;
    const trajectory = unit.trajectory();
    const currentIndex = unit.trajectoryIndex();
    const timeToExplode = Math.max(1, trajectory.length - currentIndex);

    const targetTile =
      unit.targetTile() ??
      (trajectory.length > 0
        ? trajectory[trajectory.length - 1].tile
        : samTile);

    const distToSilo = this.mg.manhattanDist(samTile, targetTile);

    // Hydro unit type bonus
    // 70,000 offset balances the distance bonus between Hydro at 100 and Atom at 30
    const typeBonus = unit.type() === UnitType.HydrogenBomb ? 70_001 : 0;

    // Distance bonus: Closer to silo higher score (-1,000 pts per unit distance)
    // due to manhattanDist, distToSilo can exceed 150 diagonally, 200000 starting point.
    const distanceBonus = Math.max(0, 200_000 - distToSilo * 1000);

    // Time based score: +100 pts per tick earlier
    // Since all nukes are already guaranteed to need a SAM response at this tick,
    // this is only a very minor tiebreaker.
    const urgencyBonus = Math.max(0, 10_000 - timeToExplode * 100);

    return typeBonus + distanceBonus + urgencyBonus;
  }

  private sortTargets(targets: Target[]): Target[] {
    if (targets.length <= 1) return targets;

    // Create a map for quick look-up time.
    const scores = new Map<Target, number>();
    for (const target of targets) {
      scores.set(target, this.computeTargetScore(target));
    }

    // Sort by score, js' Timsort guarantees O(n log n)
    return targets.sort((a, b) => scores.get(b)! - scores.get(a)!);
  }

  public getValidTargets(ticks: number): Target[] {
    const samTile = this.sam.tile();
    const range = this.mg.config().samRange(this.sam.level());
    const rangeSquared = range * range;

    // Look beyond the SAM range so it can preshot nukes.
    // Every missile should be spotted in time to allow it to be shot down at maxSamRange
    // Times 3 is barely not enough for a MIRV warhead (speed 22 vs SAM 12)
    const detectionRange = this.mg.config().maxSamRange() * 4;
    const nukes = this.mg.nearbyUnits(
      samTile,
      detectionRange,
      [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRVWarhead],
      ({ unit }) => {
        if (!isUnit(unit) || unit.targetedBySAM()) return false;
        if (unit.owner() === this.sam.owner()) return false;

        const samOwner = this.sam.owner();
        const nukeOwner = unit.owner();

        // After game-over in team games, SAMs also target teammate nukes (aftergame fun)
        if (samOwner.isFriendly(nukeOwner)) {
          return (
            this.mg.getWinner() !== null && samOwner.isOnSameTeam(nukeOwner)
          );
        }

        return true;
      },
    );

    // Clear unreachable nukes that went out of range
    this.updateUnreachableNukes(nukes);

    const targets: Target[] = [];
    for (const nuke of nukes) {
      const nukeId = nuke.unit.id();
      const cached = this.precomputedNukes.get(nukeId);
      if (cached !== undefined) {
        if (cached === null) {
          // Already computed as unreachable, skip
          continue;
        }
        if (cached.tick === ticks || cached.tick === ticks + 1) {
          // Time to shoot!
          targets.push({ tile: cached.tile, unit: nuke.unit });
          this.precomputedNukes.delete(nukeId);
          continue;
        }
        if (cached.tick > ticks) {
          // Not due yet, skip for now.
          continue;
        }
        // Missed the planned tick (e.g was on cooldown), recompute a new interception tile if possible
        this.precomputedNukes.delete(nukeId);
      }
      const interceptionTile = this.computeInterceptionTile(
        nuke.unit,
        samTile,
        rangeSquared,
      );
      if (interceptionTile !== undefined) {
        if (interceptionTile.tick <= 1) {
          // Shoot instantly
          targets.push({
            unit: nuke.unit,
            tile: interceptionTile.tile,
          });
        } else {
          // Nuke will be reachable but not yet. Store the result.
          this.precomputedNukes.set(nukeId, {
            tick: interceptionTile.tick + ticks,
            tile: interceptionTile.tile,
          });
        }
      } else {
        // Store unreachable nukes in order to prevent useless interception computation
        this.precomputedNukes.set(nukeId, null);
      }
    }

    // This function can easily find further use later to prioritize nukes
    // So we can start checking for nukes across multiple ticks
    return this.sortTargets(targets);
  }
}

export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  private targetingSystem: SAMTargetingSystem;

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
    this.targetingSystem ??= new SAMTargetingSystem(this.mg, this.sam);

    if (this.sam.isUnderConstruction()) {
      return;
    }

    if (!this.sam.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.sam.owner()) {
      this.player = this.sam.owner();
    }

    while (this.sam.missileTimerQueue().length > 0) {
      const frontTime = this.sam.missileTimerQueue()[0];
      const cooldown =
        this.mg.config().SAMCooldown() - (this.mg.ticks() - frontTime);

      if (cooldown > 0) {
        break;
      }
      this.sam.reloadMissile();
    }
    if (this.sam.isInCooldown()) {
      return;
    }

    this.pseudoRandom ??= new PseudoRandom(this.sam.id());

    // target is already filtered to exclude nukes targeted by other SAMs
    const targets = this.targetingSystem.getValidTargets(ticks);
    for (const target of targets) {
      if (this.sam.isInCooldown()) {
        break;
      }
      this.sam.launch();
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
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
