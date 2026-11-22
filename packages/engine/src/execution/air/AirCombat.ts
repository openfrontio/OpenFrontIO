import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Aircraft, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  AIRBASE_DOCKING_RANGE,
  altitudeOf,
  isTrackedByRadar,
} from "@openfront/engine-lib/game/AirRules";
import { Game, Player, Unit } from "../../game/Game";

/*
 * AIR update: engine-side helpers shared by aircraft and air-defence
 * executions. The detection rule itself lives in engine-lib/AirRules so the
 * client renders the same coverage.
 */

/** Whether `observer` may shoot at `unit` (same rule warships use). */
export function isHostileTo(observer: Player, unit: Unit): boolean {
  const owner = unit.owner();
  return owner !== observer && observer.canAttackPlayer(owner, true);
}

/**
 * Whether `observer`'s radar network (its own and its allies' radar stations
 * and airbases) tracks `aircraft`.
 */
export function isTrackedBy(
  game: Game,
  observer: Player,
  aircraft: Unit,
): boolean {
  return isTrackedByRadar(
    game,
    aircraft.tile(),
    altitudeOf(aircraft.type()),
    (sensor) => {
      const sensorOwner = sensor.owner() as Player;
      return sensorOwner === observer || observer.isFriendly(sensorOwner);
    },
  );
}

/** True when no aircraft exists anywhere: lets defences skip their queries. */
export function noAircraftInFlight(game: Game): boolean {
  for (const type of Aircraft.types) {
    if (game.unitCount(type) > 0) return false;
  }
  return true;
}

/** Tick-steps between two tiles for 8-directional movement. */
export function chebyshevDist(game: Game, a: TileRef, b: TileRef): number {
  return Math.max(
    Math.abs(game.x(a) - game.x(b)),
    Math.abs(game.y(a) - game.y(b)),
  );
}

/** The owner's operational airbase nearest to `tile`, if any. */
export function nearestAirbase(
  game: Game,
  owner: Player,
  tile: TileRef,
): Unit | undefined {
  let best: Unit | undefined;
  let bestDist = Infinity;
  for (const base of owner.units(UnitType.Airbase)) {
    if (!base.isActive() || base.isUnderConstruction()) continue;
    const d = chebyshevDist(game, base.tile(), tile);
    if (d < bestDist) {
      bestDist = d;
      best = base;
    }
  }
  return best;
}

/** The owner's operational airbase on (or next to) `tile`, if any. */
export function airbaseAt(
  game: Game,
  owner: Player,
  tile: TileRef,
): Unit | undefined {
  const base = nearestAirbase(game, owner, tile);
  if (base === undefined) return undefined;
  return chebyshevDist(game, base.tile(), tile) <= AIRBASE_DOCKING_RANGE + 1
    ? base
    : undefined;
}
