import { UnitView } from "src/client/view";
import { Execution, Game, isUnit, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { SAMMissileExecution } from "./SAMMissileExecution";

type Target = {
  unit: Unit;
  tile: TileRef;
  score?: number;
};

type InterceptionTile = {
  tile: TileRef;
  tick: number;
};

type CachedInterception = {
  tick: number; // >= 0: scheduled launch tick, -1: unreachable at current upgrade, -2: permanently out of reach
  tile: TileRef;
  minDistSq: number;
  lastSeenTick: number;
};

/**
 * Smart SAM targeting system preshoting nukes so its range is strictly enforced
 */
class SAMTargetingSystem {
  // Cached interception states indexed by nuke ID to avoid per-tick recomputation.
  private readonly precomputedNukes: Map<number, CachedInterception> =
    new Map();
  private readonly missileSpeed: number;

  constructor(
    private readonly mg: Game,
    private readonly sam: Unit,
  ) {
    this.missileSpeed = this.mg.config().defaultSamMissileSpeed();
    this.isTargetableNearbyUnit = this.isTargetableNearbyUnit.bind(this);
  }

  onLevelUp(): void {
    for (const [id, cached] of this.precomputedNukes) {
      if (cached.tick === -1) {
        this.precomputedNukes.delete(id);
      }
    }
  }

  updateUnreachableNukes(currentTick: number): void {
    for (const [id, cached] of this.precomputedNukes) {
      if (cached.lastSeenTick !== currentTick) {
        this.precomputedNukes.delete(id);
      }
    }
  }

  private tickToReach(currentTile: TileRef, tile: TileRef): number {
    return Math.ceil(
      this.mg.manhattanDist(currentTile, tile) / this.missileSpeed,
    );
  }

  private checkDetonationInterception(
    unit: Unit,
    samTile: TileRef,
    ticks: number,
  ): InterceptionTile | undefined {
    const trajectory = unit.trajectory();
    const maxIdx = trajectory.length - 2;
    const finalTile = trajectory[trajectory.length - 1];
    if (!finalTile?.targetable) return undefined;

    const curIdx = unit.trajectoryIndex();
    const waitTicks = unit.nukeState().waitTicks ?? 0;
    const expTicks = trajectory.length - 1 - curIdx + waitTicks;
    const range = this.mg.config().dynamicSamRange(this.sam, ticks + expTicks);
    if (this.mg.euclideanDistSquared(samTile, finalTile.tile) > range * range) {
      return undefined;
    }
    const flightTile = trajectory[maxIdx];
    if (!flightTile?.targetable) return undefined;

    const nukeTicks = maxIdx - curIdx + waitTicks;
    const samTicks = this.tickToReach(samTile, flightTile.tile);
    const tickBeforeShooting = nukeTicks - samTicks;
    return tickBeforeShooting >= 0
      ? { tick: tickBeforeShooting, tile: flightTile.tile }
      : undefined;
  }

  private computeInterceptionTile(
    unit: Unit,
    samTile: TileRef,
    ticks: number,
  ): CachedInterception {
    const trajectory = unit.trajectory();
    const curIdx = unit.trajectoryIndex();
    const waitTicks = unit.nukeState().waitTicks ?? 0;
    const maxIdx = trajectory.length - 2;
    const maxSamRangeSq = this.mg.config().maxSamRange() ** 2;
    let minDistSq = Infinity;
    let closestTile = samTile;
    let incSteps = 0;
    let lastDistSq = -1;

    for (let i = curIdx; i <= maxIdx; i++) {
      const tile = trajectory[i];
      const distSq = this.mg.euclideanDistSquared(samTile, tile.tile);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestTile = tile.tile;
      }
      incSteps = lastDistSq !== -1 && distSq > lastDistSq ? incSteps + 1 : 0;
      lastDistSq = distSq;

      const nukeTicks = i - curIdx + waitTicks;
      const samTicks = this.tickToReach(samTile, tile.tile);
      const allowed = this.mg
        .config()
        .dynamicSamRange(this.sam, ticks + nukeTicks);
      if (
        tile.targetable &&
        distSq <= allowed * allowed &&
        nukeTicks >= samTicks
      ) {
        return {
          tick: nukeTicks - samTicks,
          tile: tile.tile,
          minDistSq,
          lastSeenTick: ticks,
        };
      }
      if (incSteps > 3 && distSq > maxSamRangeSq) break;
    }

    const det = this.checkDetonationInterception(unit, samTile, ticks);
    if (det) {
      return { tick: det.tick, tile: det.tile, minDistSq, lastSeenTick: ticks };
    }
    return {
      tick: minDistSq > maxSamRangeSq ? -2 : -1,
      tile: closestTile,
      minDistSq,
      lastSeenTick: ticks,
    };
  }

  private isTargetableNearbyUnit({ unit }: { unit: Unit | UnitView }): boolean {
    return this.isValidNukeTarget(unit);
  }

  private isValidNukeTarget(unit: Unit | UnitView): boolean {
    if (
      !isUnit(unit) ||
      unit.targetedBySAM() ||
      unit.owner() === this.sam.owner()
    ) {
      return false;
    }
    const samOwner = this.sam.owner();
    const nukeOwner = unit.owner();
    if (samOwner.isFriendly(nukeOwner)) {
      return this.mg.getWinner() !== null && samOwner.isOnSameTeam(nukeOwner);
    }
    return true;
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

    for (const target of targets) {
      target.score = this.computeTargetScore(target);
    }

    // Sort by score, js' Timsort guarantees O(n log n)
    return targets.sort((a, b) => b.score! - a.score!);
  }

  public getValidTargets(ticks: number): Target[] {
    const samTile = this.sam.tile();
    const detectionRange = this.mg.config().maxSamRange() * 4;
    const nukes = this.mg.nearbyUnits(
      samTile,
      detectionRange,
      [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRVWarhead],
      this.isTargetableNearbyUnit,
    );

    const targets: Target[] = [];
    for (const nuke of nukes) {
      const id = nuke.unit.id();
      const cached = this.precomputedNukes.get(id);
      if (cached !== undefined) {
        cached.lastSeenTick = ticks;

        if (cached.tick === -2 || cached.tick === -1) continue;

        if (cached.tick === ticks || cached.tick === ticks + 1) {
          targets.push({ tile: cached.tile, unit: nuke.unit });
          this.precomputedNukes.delete(id);
          continue;
        }

        if (cached.tick > ticks) continue;

        this.precomputedNukes.delete(id);
      }

      const res = this.computeInterceptionTile(nuke.unit, samTile, ticks);
      if (res.tick >= 0 && res.tick <= 1) {
        targets.push({ unit: nuke.unit, tile: res.tile });
      } else {
        this.precomputedNukes.set(id, {
          tick: res.tick >= 0 ? res.tick + ticks : res.tick,
          tile: res.tile,
          minDistSq: res.minDistSq,
          lastSeenTick: ticks,
        });
      }
    }
    this.updateUnreachableNukes(ticks);
    return this.sortTargets(targets);
  }
}

export class SAMLauncherExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  private targetingSystem: SAMTargetingSystem;

  private pseudoRandom: PseudoRandom | undefined;
  private lastLevel: number = 1;

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

    if (this.lastLevel !== this.sam.level()) {
      this.lastLevel = this.sam.level();
      this.targetingSystem.onLevelUp();
    }

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
