import { Game, isUnit, Player, Unit, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";

export type AirDefenseTarget = {
  unit: Unit;
  tile: TileRef;
};

type InterceptionTile = {
  tile: TileRef;
  tick: number;
};

export type AirDefenseUnitFilter = (
  unit: Unit,
  interceptor: Unit,
  game: Game,
) => boolean;

function canTargetEnemyAirUnit(
  owner: Player,
  threat: Unit,
  game: Game,
): boolean {
  if (threat.owner() === owner) {
    return false;
  }

  const threatOwner = threat.owner();

  // After game-over in team games, air defense also targets teammate threats.
  if (owner.isFriendly(threatOwner)) {
    return game.getWinner() !== null && owner.isOnSameTeam(threatOwner);
  }

  return true;
}

export class AirDefenseTargetingSystem {
  // Interception tiles are computed once and reused until either the threat leaves
  // the search area or the interceptor changes tile/level.
  private readonly precomputedNukes: Map<number, InterceptionTile | null> =
    new Map();
  private readonly missileSpeed: number;
  private lastInterceptorOwnerId: string | null = null;
  private lastInterceptorTile: TileRef | null = null;
  private lastInterceptorLevel: number | null = null;

  constructor(
    private readonly mg: Game,
    private readonly interceptor: Unit,
    private readonly unitFilter?: AirDefenseUnitFilter,
  ) {
    this.missileSpeed = this.mg.config().defaultSamMissileSpeed();
  }

  private resetIfInterceptorChanged() {
    const ownerId = this.interceptor.owner().id();
    const tile = this.interceptor.tile();
    const level = this.interceptor.level();
    if (
      this.lastInterceptorOwnerId === ownerId &&
      this.lastInterceptorTile === tile &&
      this.lastInterceptorLevel === level
    ) {
      return;
    }

    this.lastInterceptorOwnerId = ownerId;
    this.lastInterceptorTile = tile;
    this.lastInterceptorLevel = level;
    this.precomputedNukes.clear();
  }

  private updateUnreachableNukes(
    nearbyUnits: { unit: Unit; distSquared: number }[],
  ) {
    if (this.precomputedNukes.size === 0) {
      return;
    }

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
    interceptorTile: TileRef,
    rangeSquared: number,
  ): InterceptionTile | undefined {
    const trajectory = unit.trajectory();
    const currentIndex = unit.trajectoryIndex();
    const explosionTick = trajectory.length - currentIndex;
    for (let i = currentIndex; i < trajectory.length; i++) {
      const trajectoryTile = trajectory[i];
      if (
        trajectoryTile.targetable &&
        this.mg.euclideanDistSquared(interceptorTile, trajectoryTile.tile) <=
          rangeSquared
      ) {
        const nukeTickToReach = i - currentIndex;
        const samTickToReach = this.tickToReach(
          interceptorTile,
          trajectoryTile.tile,
        );
        const tickBeforeShooting = nukeTickToReach - samTickToReach;
        if (samTickToReach < explosionTick && tickBeforeShooting >= 0) {
          return { tick: tickBeforeShooting, tile: trajectoryTile.tile };
        }
      }
    }
    return undefined;
  }

  public getSingleTarget(ticks: number): AirDefenseTarget | null {
    this.resetIfInterceptorChanged();

    const interceptorTile = this.interceptor.tile();
    const range = this.mg.config().samRange(this.interceptor.level());
    const rangeSquared = range * range;

    const detectionRange = this.mg.config().maxSamRange() * 2;
    const nukes = this.mg.nearbyUnits(
      interceptorTile,
      detectionRange,
      [UnitType.AtomBomb, UnitType.HydrogenBomb],
      ({ unit }) => {
        if (!isUnit(unit) || unit.targetedBySAM()) return false;
        if (!canTargetEnemyAirUnit(this.interceptor.owner(), unit, this.mg)) {
          return false;
        }
        return this.unitFilter?.(unit, this.interceptor, this.mg) ?? true;
      },
    );

    this.updateUnreachableNukes(nukes);

    let best: AirDefenseTarget | null = null;
    for (const nuke of nukes) {
      const nukeId = nuke.unit.id();
      const cached = this.precomputedNukes.get(nukeId);
      if (cached !== undefined) {
        if (cached === null) {
          continue;
        }
        if (cached.tick === ticks) {
          const target = { tile: cached.tile, unit: nuke.unit };
          if (
            best === null ||
            (target.unit.type() === UnitType.HydrogenBomb &&
              best.unit.type() !== UnitType.HydrogenBomb)
          ) {
            best = target;
          }
          this.precomputedNukes.delete(nukeId);
          continue;
        }
        if (cached.tick > ticks) {
          continue;
        }
        this.precomputedNukes.delete(nukeId);
      }

      const interceptionTile = this.computeInterceptionTile(
        nuke.unit,
        interceptorTile,
        rangeSquared,
      );
      if (interceptionTile !== undefined) {
        if (interceptionTile.tick <= 1) {
          const target = { unit: nuke.unit, tile: interceptionTile.tile };
          if (
            best === null ||
            (target.unit.type() === UnitType.HydrogenBomb &&
              best.unit.type() !== UnitType.HydrogenBomb)
          ) {
            best = target;
          }
        } else {
          this.precomputedNukes.set(nukeId, {
            tick: interceptionTile.tick + ticks,
            tile: interceptionTile.tile,
          });
        }
      } else {
        this.precomputedNukes.set(nukeId, null);
      }
    }

    return best;
  }
}

export function findMirvWarheadTargets(
  mg: Game,
  interceptor: Unit,
  unitFilter?: AirDefenseUnitFilter,
  searchRadius: number = 400,
): Array<{ unit: Unit; distSquared: number }> {
  return mg.nearbyUnits(
    interceptor.tile(),
    searchRadius,
    UnitType.MIRVWarhead,
    ({ unit }) => {
      if (!isUnit(unit)) return false;
      if (!canTargetEnemyAirUnit(interceptor.owner(), unit, mg)) return false;
      return unitFilter?.(unit, interceptor, mg) ?? true;
    },
  );
}
