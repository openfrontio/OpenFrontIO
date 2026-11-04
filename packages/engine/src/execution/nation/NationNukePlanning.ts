import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../../game/Game";
import { UniversalPathFinding } from "../../pathfinding/PathFinder";

export type NukeType = UnitType.AtomBomb | UnitType.HydrogenBomb;

/** Cap on silo levels reachable via the SAM salvo's upgrade fallback. */
const MAX_NATION_SILO_UPGRADE_LEVEL = 5;

/** Whether our inner blast would overlap the inner blast of any player's nuke in flight. */
export function isNukeAlreadyLandingNear(
  game: Game,
  tile: TileRef,
  nukeType: NukeType,
): boolean {
  const config = game.config();
  const ourInnerRadius = config.nukeMagnitudes(nukeType).inner;
  const nukesInFlight = game.units(
    UnitType.AtomBomb,
    UnitType.HydrogenBomb,
    UnitType.MIRVWarhead,
  );
  for (const nuke of nukesInFlight) {
    const targetTile = nuke.targetTile();
    if (targetTile === undefined) continue;
    const sumRadius = ourInnerRadius + config.nukeMagnitudes(nuke.type()).inner;
    if (game.euclideanDistSquared(tile, targetTile) <= sumRadius * sumRadius) {
      return true;
    }
  }
  return false;
}

/**
 * Grid-sampled share of the blast that hits land of players not friendly to
 * player. Inner radius tiles count double, as the outer ring is only
 * partially destroyed.
 */
export function enemyLandBlastCoverage(
  game: Game,
  player: Player,
  center: TileRef,
  nukeType: NukeType,
): number {
  const { inner, outer } = game.config().nukeMagnitudes(nukeType);
  const step = Math.max(1, Math.floor(outer / 10));
  const cx = game.x(center);
  const cy = game.y(center);
  let total = 0;
  let enemyLand = 0;
  for (let dy = -outer; dy <= outer; dy += step) {
    for (let dx = -outer; dx <= outer; dx += step) {
      const distSquared = dx * dx + dy * dy;
      if (distSquared > outer * outer) continue;
      const weight = distSquared <= inner * inner ? 2 : 1;
      total += weight;
      if (!game.isValidCoord(cx + dx, cy + dy)) continue;
      // Water, fallout and unowned land have no player owner
      const owner = game.owner(game.ref(cx + dx, cy + dy));
      if (owner.isPlayer() && !player.isFriendly(owner, true)) {
        enemyLand += weight;
      }
    }
  }
  return enemyLand / total;
}

/** Whether any tile in the blast, widened by margin, belongs to player, a teammate or an ally (even AFK ones). */
export function blastHitsFriendlyLand(
  game: Game,
  player: Player,
  center: TileRef,
  nukeType: NukeType,
  margin = 0,
): boolean {
  const friendlyIds = new Set(
    game
      .players()
      .filter((p) => player.isFriendly(p, true))
      .map((p) => p.smallID()),
  );
  const outer = game.config().nukeMagnitudes(nukeType).outer + margin;
  const cx = game.x(center);
  const cy = game.y(center);
  for (let dy = -outer; dy <= outer; dy++) {
    for (let dx = -outer; dx <= outer; dx++) {
      if (dx * dx + dy * dy > outer * outer) continue;
      if (!game.isValidCoord(cx + dx, cy + dy)) continue;
      const ownerId = game.ownerID(game.ref(cx + dx, cy + dy));
      if (friendlyIds.has(ownerId)) return true;
    }
  }
  return false;
}

// Whether a SAM hostile to player can shoot down a bomb flying from spawnTile
// to targetTile; mirroring NukeTrajectoryPreviewLayer.ts logic a bit
export function isTrajectoryInterceptableBySam(
  game: Game,
  player: Player,
  spawnTile: TileRef,
  targetTile: TileRef,
  excludedSamIds?: Set<number>,
): boolean {
  const speed = game.config().nukeSpeed(UnitType.AtomBomb);
  const pathFinder = UniversalPathFinding.Parabola(game, {
    increment: speed,
    distanceBasedHeight: true, // Atom/Hydrogen bombs use distance-based height
    directionUp: true, // AI nukes always go "up" for now
  });

  const trajectory = pathFinder.findPath(spawnTile, targetTile) ?? [];
  if (trajectory.length === 0) {
    return false;
  }

  const targetRangeSquared = game.config().defaultNukeTargetableRange() ** 2;

  let untargetableStart = -1;
  let untargetableEnd = -1;
  for (let i = 0; i < trajectory.length; i++) {
    const tile = trajectory[i];
    if (untargetableStart === -1) {
      if (game.euclideanDistSquared(tile, spawnTile) > targetRangeSquared) {
        if (game.euclideanDistSquared(tile, targetTile) < targetRangeSquared) {
          // Overlapping spawn & target range – no untargetable segment.
          break;
        } else {
          untargetableStart = i;
        }
      }
    } else if (
      game.euclideanDistSquared(tile, targetTile) < targetRangeSquared
    ) {
      untargetableEnd = i;
      break;
    }
  }

  for (let i = 0; i < trajectory.length; i++) {
    // Skip the mid-air untargetable portion
    if (
      untargetableStart !== -1 &&
      untargetableEnd !== -1 &&
      i === untargetableStart
    ) {
      i = untargetableEnd - 1;
      continue;
    }

    const tile = trajectory[i];
    const nearbySams = game.nearbyUnits(
      tile,
      game.config().maxSamRange(),
      UnitType.SAMLauncher,
    );

    for (const sam of nearbySams) {
      const owner = sam.unit.owner();
      if (owner === player || player.isFriendly(owner)) {
        continue;
      }
      // Skip SAMs we're intentionally overwhelming
      if (excludedSamIds?.has(sam.unit.id())) {
        continue;
      }
      const rangeSquared = game.config().samRange(sam.unit.level()) ** 2;
      if (sam.distSquared <= rangeSquared) {
        return true;
      }
    }
  }

  return false;
}

/** Atom bombs aimed at targetTile, each launched after its wait so all arrive within one SAM cooldown. */
export interface SamSalvo {
  targetTile: TileRef;
  waitTicks: number[];
}

/** A SAM salvo our silos lacked the capacity for. */
export interface FailedSamSalvo {
  targetTile: TileRef;
  coveringSamIds: Set<number>;
  totalBombs: number;
}

/**
 * An atom bomb salvo from player that destroys one of target's SAMs, trying
 * the easiest (lowest level) first. A SAM of level N can intercept N nukes
 * before going on cooldown, so it takes N+1 bombs (accounting for all
 * covering SAMs). Without one, `failed` is the first SAM our silos lacked
 * the capacity for; a SAM we only lack the gold for leaves it null.
 */
export function planSamSalvo(
  game: Game,
  player: Player,
  target: Player,
): { salvo: SamSalvo | null; failed: FailedSamSalvo | null } {
  const atomCost = game.unitInfo(UnitType.AtomBomb).cost(game, player);
  const enemySams = target.units(UnitType.SAMLauncher);
  if (enemySams.length === 0) {
    return { salvo: null, failed: null };
  }

  const ourSilos = player
    .units(UnitType.MissileSilo)
    .filter((silo) => !silo.isUnderConstruction());
  if (ourSilos.length === 0) {
    return { salvo: null, failed: null };
  }

  // Try each enemy SAM as a target, easiest (lowest level) first
  const sortedSams = enemySams.slice().sort((a, b) => a.level() - b.level());
  // Track the first failed attempt so we can upgrade a silo that would
  // actually have helped that plan (rather than an unrelated silo).
  let failed: FailedSamSalvo | null = null;

  for (const targetSam of sortedSams) {
    const targetTile = targetSam.tile();
    // Hitting an ally's land would break the alliance
    if (blastHitsFriendlyLand(game, player, targetTile, UnitType.AtomBomb)) {
      continue;
    }

    // Find all enemy SAMs whose range covers the target tile (they will all try to intercept)
    const coveringSams = findEnemySamsCoveringTile(game, player, targetTile);
    const coveringSamIds = new Set(coveringSams.map((s) => s.id()));

    // Total interception capacity = sum of covering SAM levels
    const totalInterceptions = coveringSams.reduce(
      (sum, sam) => sum + sam.level(),
      0,
    );
    const bombsNeeded = totalInterceptions + 1;

    // NukeExecution always picks the closest non-cooldown silo by Manhattan
    // distance to target (via nukeSpawn). Our planning must mirror that order.
    // Silos with interceptable trajectories will still be picked first by
    // NukeExecution — their bombs launch but get intercepted, "wasting" slots.
    const nukeSpeed = game.config().nukeSpeed(UnitType.AtomBomb);
    const allAvailableSilos: {
      silo: Unit;
      slots: number;
      flightTicks: number;
      interceptable: boolean;
    }[] = [];
    for (const silo of ourSilos) {
      const availableSlots = silo.level() - silo.missileTimerQueue().length;
      if (availableSlots <= 0) {
        continue;
      }
      const interceptable = isTrajectoryInterceptableBySam(
        game,
        player,
        silo.tile(),
        targetTile,
        coveringSamIds,
      );
      // Compute actual parabolic flight time in ticks
      const pathFinder = UniversalPathFinding.Parabola(game, {
        increment: nukeSpeed,
        distanceBasedHeight: true,
        directionUp: true,
      });
      const trajectory = pathFinder.findPath(silo.tile(), targetTile) ?? [];
      if (trajectory.length === 0) continue;
      allAvailableSilos.push({
        silo,
        slots: availableSlots,
        flightTicks: trajectory.length,
        interceptable,
      });
    }

    // Sort by Manhattan distance to target (matching nukeSpawn's pick order)
    allAvailableSilos.sort(
      (a, b) =>
        game.manhattanDist(a.silo.tile(), targetTile) -
        game.manhattanDist(b.silo.tile(), targetTile),
    );

    // Flatten into a per-bomb launch sequence matching NukeExecution's order.
    // Each silo contributes `slots` consecutive bombs before NukeExecution
    // moves to the next silo.
    const launchSequence: {
      flightTicks: number;
      interceptable: boolean;
    }[] = [];
    for (const entry of allAvailableSilos) {
      for (let s = 0; s < entry.slots; s++) {
        launchSequence.push({
          flightTicks: entry.flightTicks,
          interceptable: entry.interceptable,
        });
      }
    }

    // Use half the SAM cooldown as the max total arrival spread to be safe.
    const samCooldown = game.config().SAMCooldown();
    const maxTotalArrivalSpread = Math.floor(samCooldown / 2);

    // Add extra bombs: 1 for every 5 to account for enemy building more SAMs
    // while our bombs are in flight
    const extraBombs = Math.floor(bombsNeeded / 5);
    const totalBombs = bombsNeeded + extraBombs;

    // Collect bombs from silos whose trajectory to the target is NOT blocked
    // by enemy SAMs other than the covering SAMs we're trying to overwhelm.
    const unblockedBombs: { index: number; flightTicks: number }[] = [];
    for (let i = 0; i < launchSequence.length; i++) {
      if (!launchSequence[i].interceptable) {
        unblockedBombs.push({
          index: i,
          flightTicks: launchSequence[i].flightTicks,
        });
      }
    }

    if (unblockedBombs.length < totalBombs) {
      failed ??= { targetTile, coveringSamIds, totalBombs };
      continue;
    }

    // Sort unblocked bombs by flight time to find a sliding window
    // of maxTotalArrivalSpread that captures the most bombs.
    const sortedByFlight = [...unblockedBombs].sort(
      (a, b) => a.flightTicks - b.flightTicks,
    );

    let bestWindowStart = 0;
    let bestWindowCount = 0;
    for (let start = 0; start < sortedByFlight.length; start++) {
      let end = start;
      while (
        end < sortedByFlight.length &&
        sortedByFlight[end].flightTicks - sortedByFlight[start].flightTicks <=
          maxTotalArrivalSpread
      ) {
        end++;
      }
      if (end - start > bestWindowCount) {
        bestWindowCount = end - start;
        bestWindowStart = start;
      }
    }

    if (bestWindowCount < totalBombs) {
      failed ??= { targetTile, coveringSamIds, totalBombs };
      continue;
    }

    // From the window, pick totalBombs with the lowest launch-sequence
    // indices to minimise how many bombs we need to fire (minimise gold cost).
    const windowBombs = sortedByFlight.slice(
      bestWindowStart,
      bestWindowStart + bestWindowCount,
    );
    const windowByIndex = [...windowBombs].sort((a, b) => a.index - b.index);
    const selected = windowByIndex.slice(0, totalBombs);
    const selectedSet = new Set(selected.map((b) => b.index));
    const lastSelectedIndex = selected[selected.length - 1].index;
    const bombsToFire = lastSelectedIndex + 1;

    // Compute per-bomb waitTicks so all selected bombs arrive in the window.
    // Target: spread arrivals evenly, anchored at the earliest flight time
    // in the selected set.
    const selectedFlightMin = Math.min(...selected.map((b) => b.flightTicks));
    const staggerInterval = Math.max(
      1,
      Math.floor(maxTotalArrivalSpread / totalBombs),
    );
    let selectedIdx = 0;
    const waitTicksPerBomb: number[] = [];
    for (let i = 0; i < bombsToFire; i++) {
      if (selectedSet.has(i)) {
        const targetArrival = selectedFlightMin + selectedIdx * staggerInterval;
        waitTicksPerBomb.push(
          Math.max(0, targetArrival - launchSequence[i].flightTicks),
        );
        selectedIdx++;
      } else {
        // Wasted bomb (interceptable or out-of-window) — launch immediately
        waitTicksPerBomb.push(0);
      }
    }

    // Check gold for all fired bombs (including wasted ones)
    const totalCost = atomCost * BigInt(bombsToFire);
    if (player.gold() < totalCost) {
      continue;
    }

    // NukeExecution will pick silos in the same Manhattan distance order we planned.
    return { salvo: { targetTile, waitTicks: waitTicksPerBomb }, failed };
  }

  return { salvo: null, failed };
}

/**
 * Find all SAMs hostile to player whose range covers a given tile.
 */
export function findEnemySamsCoveringTile(
  game: Game,
  player: Player,
  tile: TileRef,
): Unit[] {
  const nearbySams = game.nearbyUnits(
    tile,
    game.config().maxSamRange(),
    UnitType.SAMLauncher,
  );

  const result: Unit[] = [];
  for (const sam of nearbySams) {
    const owner = sam.unit.owner();
    if (owner === player || player.isFriendly(owner)) {
      continue;
    }
    const range = game.config().samRange(sam.unit.level());
    if (sam.distSquared <= range * range) {
      result.push(sam.unit);
    }
  }
  return result;
}

/**
 * A missile silo whose upgrade would actually have helped the failed
 * salvo: trajectory to the failed target is not blocked by non-covering
 * enemy SAMs, and the silo is below the upgrade cap. Among those, picks the
 * one best protected by our own SAMs.
 */
export function siloToUpgradeForSalvo(
  game: Game,
  player: Player,
  failed: FailedSamSalvo,
): Unit | null {
  const silos = player.units(UnitType.MissileSilo);
  if (silos.length === 0) return null;

  // First pass: find silos with an unblocked trajectory to the failed
  // target. Only these contribute slots to the overwhelm plan.
  // "Unblocked" means not interceptable by non-covering enemy SAMs.
  const unblockedSilos: Unit[] = [];
  for (const silo of silos) {
    if (
      !isTrajectoryInterceptableBySam(
        game,
        player,
        silo.tile(),
        failed.targetTile,
        failed.coveringSamIds,
      )
    ) {
      unblockedSilos.push(silo);
    }
  }
  if (unblockedSilos.length === 0) return null;

  // Bail out if the target is unreachable even at max silo level —
  // crazy amounts of covering SAMs, upgrading is wasted gold.
  const maxAchievableSlots =
    unblockedSilos.length * MAX_NATION_SILO_UPGRADE_LEVEL;
  if (maxAchievableSlots < failed.totalBombs) return null;

  const ourSams = player.units(UnitType.SAMLauncher);
  let bestSilo: Unit | null = null;
  let bestProtection = -1;

  for (const silo of unblockedSilos) {
    if (silo.level() >= MAX_NATION_SILO_UPGRADE_LEVEL) continue;
    if (!player.canUpgradeUnit(silo)) continue;

    let protection = 0;
    for (const sam of ourSams) {
      const range = game.config().samRange(sam.level());
      const distSquared = game.euclideanDistSquared(silo.tile(), sam.tile());
      if (distSquared <= range * range) {
        protection += sam.level();
      }
    }

    if (protection > bestProtection) {
      bestProtection = protection;
      bestSilo = silo;
    }
  }

  return bestSilo;
}
