/**
 * Rising sea level pacing math, shared by the authoritative sim
 * (RisingSeaLevelExecution) and the client HUD readout so the two always agree.
 *
 * The sea floods the map from the coast inward, low ground first: the mode is a
 * whole-map timer, not a per-player one. After a flat grace it takes land at the
 * deadline quota ceil(tilesLeft / secondsLeft), so all reachable land is under
 * water submergeSeconds after the grace ends whatever the map size — the quota
 * self-corrects, exactly like doomsdayClockRotQuota.
 *
 * Integer-only and floored, no PRNG: every value the sim derives from here is
 * bit-identical on every client in the lockstep sim.
 */

export type RisingSeaLevelSpeed = "slow" | "normal" | "fast" | "veryfast";

/** In selector order. */
export const RISING_SEA_LEVEL_SPEEDS: RisingSeaLevelSpeed[] = [
  "slow",
  "normal",
  "fast",
  "veryfast",
];

/** The highest land elevation (GameMap magnitude 30); 31 means impassable. */
export const MAX_LAND_MAGNITUDE = 30;
/** Number of breach-level buckets: one per land elevation, 0..30 inclusive. */
export const BREACH_LEVEL_COUNT = MAX_LAND_MAGNITUDE + 1;

interface FloodSchedule {
  /** Flat, dry window at the very start: the early game is unaffected. It must
   *  comfortably outlast the spawn phase plus spawn immunity, because flooding
   *  is environmental and immunity does not protect against it. */
  graceSeconds: number;
  /** How long the flood takes, from the end of the grace to full submersion. */
  submergeSeconds: number;
}

// Grace is 3 minutes on every preset; only the flood itself changes pace. The
// user-facing minute figure is grace + submerge (the whole game), which is what
// the preset labels promise: slow 38, normal 28, fast 21, veryfast 15.
const SCHEDULES: Record<RisingSeaLevelSpeed, FloodSchedule> = {
  slow: { graceSeconds: 180, submergeSeconds: 2100 }, // 3:00 + 35:00
  normal: { graceSeconds: 180, submergeSeconds: 1500 }, // 3:00 + 25:00
  fast: { graceSeconds: 180, submergeSeconds: 1080 }, // 3:00 + 18:00
  veryfast: { graceSeconds: 180, submergeSeconds: 720 }, // 3:00 + 12:00
};

export function risingSeaLevelSchedule(
  speed: RisingSeaLevelSpeed,
): FloodSchedule {
  return SCHEDULES[speed] ?? SCHEDULES.normal;
}

/**
 * Tiles the sea takes this second: the deadline quota ceil(tilesLeft /
 * secondsLeft). Self-correcting, so the submergeSeconds deadline holds whatever
 * the map size and however far behind the flood has fallen. Shared so the HUD
 * readout and the sim cannot drift.
 */
export function risingSeaFloodQuota(
  tilesLeft: number,
  elapsedFloodSeconds: number,
  submergeSeconds: number,
): number {
  if (tilesLeft <= 0 || submergeSeconds <= 0) return 0;
  const secondsLeft = Math.max(1, submergeSeconds - elapsedFloodSeconds);
  return Math.ceil(tilesLeft / secondsLeft);
}

/**
 * Land the flood always leaves dry. It exists because numLandTiles() === 0
 * degenerates the sim — AttackExecution divides by it for the fallout ratio —
 * and it is also what guarantees the mode terminates: WinCheckExecution's bar is
 * a share of the shrinking remainder, so a side wins long before the last tile.
 *
 * A small ABSOLUTE constant on purpose. A ratio (say land/200) would leave over
 * ten thousand permanently dry tiles on the largest maps, enough to stalemate on,
 * which breaks the mode's premise that everything drowns.
 */
export function risingSeaReserveTiles(reachableTotal: number): number {
  if (reachableTotal <= 0) return 0;
  return Math.min(256, Math.ceil(reachableTotal / 100));
}

/**
 * Whether a map can flood at all. The sea needs a coastline to start from, and
 * a handful of maps (alps, thebox) are solid land edge to edge — there the mode
 * would sit at 0% forever, so the lobby hides the toggle. Reads the manifest so
 * the lobby does not have to download the terrain binary to find out.
 */
export function risingSeaLevelSupported(map: {
  width: number;
  height: number;
  num_land_tiles: number;
}): boolean {
  return map.num_land_tiles < map.width * map.height;
}

export interface RisingSeaLevelState {
  /** True before the flood starts (inside the grace window). */
  inGrace: boolean;
  /** Seconds until the first tile floods (0 once flooding). */
  secondsToStart: number;
  /** Seconds until all reachable land is expected to be under water (0 when past). */
  secondsToFull: number;
  /** Share of the reachable land under water, 0-100. */
  floodedPercent: number;
}

/**
 * Display-only companion for the HUD, derived from nothing but the schedule and
 * the clock.
 *
 * The share flooded is read off the schedule rather than off a land count, and
 * that is not an approximation: the sim's quota self-corrects every second to
 * land exactly on the deadline, so elapsed flood time IS the progress. It also
 * means every client shows the same figure without a wire channel, and a
 * spectator or a reconnecting player who never saw the dry map still reads it
 * correctly — a sampled baseline would give each of them a different number.
 */
export function risingSeaLevelState(
  speed: RisingSeaLevelSpeed,
  elapsed: number,
): RisingSeaLevelState {
  const s = risingSeaLevelSchedule(speed);
  const inGrace = elapsed < s.graceSeconds;
  const floodSeconds = Math.max(0, elapsed - s.graceSeconds);
  return {
    inGrace,
    secondsToStart: inGrace ? s.graceSeconds - elapsed : 0,
    secondsToFull: Math.max(0, s.submergeSeconds - floodSeconds),
    floodedPercent: Math.min(
      100,
      Math.floor((floodSeconds * 100) / s.submergeSeconds),
    ),
  };
}
