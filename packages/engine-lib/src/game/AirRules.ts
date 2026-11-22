import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { Helicopters, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameLike, UnitLike } from "@openfront/engine-api/game/ReadViews";

/*
 * AIR update: rules shared by the simulation and the client.
 *
 * Everything here is integer (or exactly reproducible) math with no
 * approximated Math functions, so the engine stays bit-identical on every
 * client and the renderer derives the same radar coverage the engine uses.
 */

export enum Altitude {
  /** Helicopters: masked from radar by terrain, below SAM engagement. */
  Low = "low",
  /** Fixed-wing aircraft: seen from far away, engageable by SAMs. */
  High = "high",
}

export type AircraftType =
  | UnitType.AttackHelicopter
  | UnitType.TransportHelicopter
  | UnitType.Fighter
  | UnitType.Bomber;

export interface AircraftSpec {
  /** Tiles moved per tick. */
  speed: number;
  /** Ticks of flight on a full tank. */
  maxFuel: number;
  /** Weapon loads per sortie. */
  ammo: number;
  /** Countermeasure (flare) charges per sortie. */
  flares: number;
  /** Organic sensor range: the aircraft sees and engages targets this close. */
  sensorRange: number;
  /** Distance at which the aircraft fires. */
  weaponRange: number;
  /** Ticks between shots. */
  reload: number;
  /** How far from its patrol tile the aircraft chases a contact. */
  commitRange: number;
  /** Fixed-wing aircraft cannot hover and orbit their station instead. */
  hovers: boolean;
}

const SPECS: Record<AircraftType, AircraftSpec> = {
  // Slow, low, tough gunship that hunts boats, warships and trains.
  [UnitType.AttackHelicopter]: {
    speed: 1,
    maxFuel: 1500,
    ammo: 12,
    flares: 2,
    sensorRange: 40,
    weaponRange: 30,
    reload: 12,
    commitRange: 70,
    hovers: true,
  },
  // Unarmed air-assault carrier: lands troops behind the front line.
  [UnitType.TransportHelicopter]: {
    speed: 2,
    maxFuel: 1800,
    ammo: 0,
    flares: 2,
    sensorRange: 0,
    weaponRange: 0,
    reload: 0,
    commitRange: 0,
    hovers: true,
  },
  // Fast air-superiority jet armed with guided air-to-air missiles.
  [UnitType.Fighter]: {
    speed: 3,
    maxFuel: 900,
    ammo: 4,
    flares: 2,
    sensorRange: 60,
    weaponRange: 45,
    reload: 25,
    commitRange: 120,
    hovers: false,
  },
  // Conventional strike aircraft: one bomb load per sortie.
  [UnitType.Bomber]: {
    speed: 2,
    maxFuel: 1500,
    ammo: 1,
    flares: 3,
    sensorRange: 0,
    weaponRange: 0,
    reload: 0,
    commitRange: 0,
    hovers: false,
  },
};

export function isAircraftType(type: UnitType): type is AircraftType {
  return type in SPECS;
}

export function aircraftSpec(type: AircraftType): AircraftSpec {
  return SPECS[type];
}

export function altitudeOf(type: UnitType): Altitude {
  return Helicopters.has(type) ? Altitude.Low : Altitude.High;
}

// ---------------------------------------------------------------------------
// Turnaround at an airbase
// ---------------------------------------------------------------------------

/** Ticks a level-1 airbase needs to refuel an empty aircraft. */
export const AIRBASE_TURNAROUND_TICKS = 120;

/** Fuel restored per docked tick: each airbase level adds a refuelling crew. */
export function refuelPerTick(maxFuel: number, airbaseLevel: number): number {
  return Math.ceil(
    (maxFuel * Math.max(1, airbaseLevel)) / AIRBASE_TURNAROUND_TICKS,
  );
}

/** Health repaired per docked tick. */
export function repairPerTick(airbaseLevel: number): number {
  return 3 * Math.max(1, airbaseLevel);
}

/** Distance (tiles) at which an aircraft counts as landed at its airbase. */
export const AIRBASE_DOCKING_RANGE = 2;

/** Extra fuel (ticks) kept in reserve when deciding to fly home. */
export const BINGO_FUEL_MARGIN = 40;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Radar station range by level: 100 at level 1, approaching 200. */
export function radarRange(level: number): number {
  return Math.floor(200 - 600 / (Math.max(1, level) + 5));
}

/** Upper bound of radarRange, used to size spatial queries. */
export const MAX_RADAR_RANGE = 200;

/** Every airbase carries a short-range approach radar. */
export const AIRBASE_RADAR_RANGE = 50;

/**
 * Terrain masking: a radar sees low-flying helicopters at this fraction
 * (numerator / denominator) of its normal range.
 */
export const LOW_ALTITUDE_RADAR_NUM = 1;
export const LOW_ALTITUDE_RADAR_DEN = 2;

function effectiveRange(range: number, altitude: Altitude): number {
  return altitude === Altitude.Low
    ? Math.floor((range * LOW_ALTITUDE_RADAR_NUM) / LOW_ALTITUDE_RADAR_DEN)
    : range;
}

/** Range at which this sensor structure sees an aircraft at `altitude`. */
export function sensorRangeOf(sensor: UnitLike, altitude: Altitude): number {
  switch (sensor.type()) {
    case UnitType.RadarStation:
      return effectiveRange(radarRange(sensor.level()), altitude);
    case UnitType.Airbase:
      return effectiveRange(AIRBASE_RADAR_RANGE, altitude);
    default:
      return 0;
  }
}

export const SENSOR_STRUCTURE_TYPES: readonly UnitType[] = [
  UnitType.RadarStation,
  UnitType.Airbase,
];

/**
 * Whether an aircraft is tracked by the radar network of the side for which
 * `isOwnSensor` returns true (typically the observer and its allies).
 *
 * Structures under construction do not see anything. The query is a single
 * spatial-grid lookup bounded by the longest radar range.
 */
export function isTrackedByRadar(
  game: GameLike,
  aircraftTile: TileRef,
  altitude: Altitude,
  isOwnSensor: (sensor: UnitLike) => boolean,
): boolean {
  return game.anyUnitNearby(
    aircraftTile,
    MAX_RADAR_RANGE,
    SENSOR_STRUCTURE_TYPES,
    (sensor) => {
      if (!isOwnSensor(sensor)) return false;
      const range = sensorRangeOf(sensor, altitude);
      return (
        game.euclideanDistSquared(sensor.tile(), aircraftTile) <= range * range
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Air defence
// ---------------------------------------------------------------------------

/** AA guns aim with their own fire-control radar: no network needed. */
export const AA_GUN_RANGE = 32;
export const AA_GUN_RELOAD_TICKS = 18;
/** Shells per volley per AA gun level, capped so stacking levels plateaus. */
export const AA_GUN_MAX_VOLLEY = 4;

/** SAM interceptors against aircraft: slower than the anti-nuke profile. */
export const SAM_AIR_MISSILE_SPEED = 8;
export const SAM_AIR_MISSILE_DAMAGE = 450;
/** Percent chance a SAM interceptor hits an aircraft that has no flares. */
export const SAM_AIR_HIT_PERCENT = 90;

export const AIR_TO_AIR_MISSILE_SPEED = 7;
export const AIR_TO_AIR_MISSILE_DAMAGE = 300;
export const AIR_TO_AIR_HIT_PERCENT = 80;

/** Percent chance a flare decoys an incoming guided missile. */
export const FLARE_DECOY_PERCENT = 50;

/** Guided missiles self-destruct after this many ticks of flight. */
export const GUIDED_MISSILE_LIFETIME = 60;

// ---------------------------------------------------------------------------
// Bombing and air assault
// ---------------------------------------------------------------------------

/** Structures within this radius of the aim point lose a level. */
export const BOMB_STRUCTURE_RADIUS = 8;
/** Per-mille of the struck owner's troops lost to one bomb load. */
export const BOMB_TROOP_KILL_PERMILLE = 30;

/** A transport helicopter lifts this fraction (1 / n) of its owner's troops. */
export const AIR_ASSAULT_TROOP_DIVISOR = 10;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * One tile toward `to`, in any of 8 directions, approximating a straight
 * line: step along an axis when the remaining offset along it is at least
 * half the offset along the other. Integer-only and stateless, so aircraft
 * can retarget every tick at O(1) cost (no path cache to rebuild).
 */
export function stepToward(map: GameMap, from: TileRef, to: TileRef): TileRef {
  const x = map.x(from);
  const y = map.y(from);
  const dx = map.x(to) - x;
  const dy = map.y(to) - y;
  if (dx === 0 && dy === 0) return from;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const sx = adx * 2 >= ady ? Math.sign(dx) : 0;
  const sy = ady * 2 >= adx ? Math.sign(dy) : 0;
  return map.ref(x + sx, y + sy);
}

/** Octagon around a fixed-wing aircraft's station, as tile offsets. */
const ORBIT_RADIUS = 7;
const ORBIT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -ORBIT_RADIUS],
  [5, -5],
  [ORBIT_RADIUS, 0],
  [5, 5],
  [0, ORBIT_RADIUS],
  [-5, 5],
  [-ORBIT_RADIUS, 0],
  [-5, -5],
];
export const ORBIT_POINTS = ORBIT_OFFSETS.length;

/** The `index`-th orbit waypoint around `center`, clamped to the map. */
export function orbitWaypoint(
  map: GameMap,
  center: TileRef,
  index: number,
): TileRef {
  const [ox, oy] = ORBIT_OFFSETS[index % ORBIT_POINTS];
  const x = Math.min(map.width() - 1, Math.max(0, map.x(center) + ox));
  const y = Math.min(map.height() - 1, Math.max(0, map.y(center) + oy));
  return map.ref(x, y);
}
