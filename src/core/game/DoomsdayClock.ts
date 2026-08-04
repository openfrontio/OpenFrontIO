/**
 * Doomsday Clock threshold math, shared by the authoritative sim
 * (DoomsdayClockExecution) and the client HUD readout so the two always agree.
 *
 * The required share of the map rises in WAVES (a battle-royale zone): one flat
 * grace at the very start, then each wave grows the share up LINEARLY over
 * rampSeconds to its level, followed by a flat pauseSeconds hold before the next
 * wave. So the bar climbs smoothly and briefly rests, it never jumps. Levels
 * track the ofstats FFA territory median and are the same for every preset; the
 * presets only change the pace (slower or faster). A side below the bar gets a
 * warn countdown, then bleeds troops. Integer-only and floored, deterministic.
 */

export type DoomsdayClockSpeed = "slow" | "normal" | "fast" | "veryfast";

/** In selector order. */
export const DOOMSDAY_CLOCK_SPEEDS: DoomsdayClockSpeed[] = [
  "slow",
  "normal",
  "fast",
  "veryfast",
];

interface WaveSchedule {
  /** Flat 0% for this long at the very start: a COMBAT-ONLY window — the clock
   *  does not touch real players early; eliminations there come from fighting. */
  graceSeconds: number;
  /** Per-wave: wave i grows its share up linearly over rampSeconds[i]. */
  rampSeconds: number[];
  /** Per-wave: flat hold after wave i's ramp before the next one starts. */
  pauseSeconds: number[];
  /** Share (basis points, 100 = 1%) reached at the end of each ramp, ascending. */
  levels: number[];
}

// Grace once (a long COMBAT-ONLY window — 0% bar, the clock ignores everyone),
// then per wave a [ramp up over rampSeconds[i]] + [hold for pauseSeconds[i]]. The
// share rises linearly during each ramp and is flat during the grace and pauses.
//
// Design: the clock is a STALEMATE-BREAKER, not an early-game culler. It stays at
// 0% for the first 10 minutes (combat decides the early game), then climbs to 35%
// by the preset's cap.
//
// Ceiling and steps come from 85 tournament games: the runner-up's share at game
// end has never exceeded 21.6%, so a bar above ~16% catches the same players while
// a higher one climbs past the leader's own share. Steps stay small because half
// the players alive at the end hold under 0.4% of the map.
const LEVELS = [200, 400, 700, 1100, 1700, 2500, 3500]; // 2/4/7/11/17/25/35%
const SCHEDULES: Record<DoomsdayClockSpeed, WaveSchedule> = {
  // grace 10:00, then seven 168s ramps + 54s pauses -> 35% at 35:00.
  normal: {
    graceSeconds: 600,
    rampSeconds: [168, 168, 168, 168, 168, 168, 168],
    pauseSeconds: [54, 54, 54, 54, 54, 54, 0],
    levels: LEVELS,
  },
  // grace 10:00, then seven 240s ramps + 70s pauses -> 35% at 45:00.
  slow: {
    graceSeconds: 600,
    rampSeconds: [240, 240, 240, 240, 240, 240, 240],
    pauseSeconds: [70, 70, 70, 70, 70, 70, 0],
    levels: LEVELS,
  },
  // grace 10:00, then seven 102s ramps + 31s pauses -> 2/4/7/11/17/25/35% at
  // 11:42/13:55/16:08/18:21/20:34/22:47/25:00 — the final bar lands exactly on a
  // 25-minute cap, so it has the whole endgame to act rather than arriving at the
  // buzzer, which is what a ceiling reached only at the cap amounts to.
  fast: {
    graceSeconds: 600,
    rampSeconds: [102, 102, 102, 102, 102, 102, 102],
    pauseSeconds: [31, 31, 31, 31, 31, 31, 0],
    levels: LEVELS,
  },
  // grace 10:00, then seven 36s ramps + 8s pauses -> 35% at 15:00.
  veryfast: {
    graceSeconds: 600,
    rampSeconds: [36, 36, 36, 36, 36, 36, 36],
    pauseSeconds: [8, 8, 8, 8, 8, 8, 0],
    levels: LEVELS,
  },
};

function schedule(speed: DoomsdayClockSpeed): WaveSchedule {
  return SCHEDULES[speed] ?? SCHEDULES.normal;
}

/**
 * Required share of the map (basis points) at `elapsed` game seconds: 0 through
 * the grace, then a linear ramp to each successive level with a flat pause after
 * each. Integer-only (floored) so every client agrees.
 */
function requiredBasisPoints(
  speed: DoomsdayClockSpeed,
  elapsed: number,
): number {
  const s = schedule(speed);
  if (elapsed <= s.graceSeconds) return 0;
  let t = elapsed - s.graceSeconds;
  let prev = 0;
  for (let i = 0; i < s.levels.length; i++) {
    const ramp = s.rampSeconds[i];
    const target = s.levels[i];
    if (t < ramp) return prev + Math.floor(((target - prev) * t) / ramp); // ramping
    t -= ramp;
    if (t < s.pauseSeconds[i]) return target; // in the pause: hold
    t -= s.pauseSeconds[i];
    prev = target;
  }
  return s.levels[s.levels.length - 1];
}

/**
 * Minimum tiles one SIDE must hold at `elapsed` game seconds — a solo player in
 * FFA, a whole team's combined territory in team modes. The bar is identical
 * for every side regardless of headcount: the clock's job is to shrink the
 * number of viable sides (floor(100 / wave%) can be above the bar at once — two
 * at the final 35% wave, so the bar narrows the field but no longer forces a
 * single winner by arithmetic alone; territory rot is what closes out the last
 * pair), and elimination happens at side
 * granularity, so scaling by member count only distorts it — a headcount-
 * scaled bar saturated at "hold the whole map" for big teams the moment the
 * grace ended, and dropped whenever a teammate died. One floored integer
 * ratio, so every client agrees.
 */
export function doomsdayClockRequiredTiles(
  speed: DoomsdayClockSpeed,
  land: number,
  elapsed: number,
): number {
  if (land <= 0) return 0;
  return Math.floor((requiredBasisPoints(speed, elapsed) * land) / 10000);
}

export interface DoomsdayClockWaveState {
  /** Required share right now, as a percent of the map (ramps during a wave). */
  currentPercent: number;
  /** The share the current (or next) ramp climbs to. */
  targetPercent: number;
  /** True while the share is actively ramping up. */
  growing: boolean;
  /** Seconds until the next ramp begins (0 while growing or once done). */
  secondsToNextGrowth: number;
  /** Seconds until the current rise reaches its target level (0 unless growing). */
  secondsToTarget: number;
  /** Within 5s before or after a ramp starting (the orange cue window). */
  waveFlash: boolean;
  /** True once the final level has been reached. */
  done: boolean;
}

/**
 * Display-only companion for the HUD: the live share, whether it is ramping or
 * holding, and the cue window. Lives here so the schedule is defined once.
 */
export function doomsdayClockWaveState(
  speed: DoomsdayClockSpeed,
  elapsed: number,
): DoomsdayClockWaveState {
  const s = schedule(speed);
  const currentPercent = requiredBasisPoints(speed, elapsed) / 100;
  const n = s.levels.length;
  const last = s.levels[n - 1] / 100;

  // Grace: flat 0; the first ramp starts at graceSeconds.
  if (elapsed <= s.graceSeconds) {
    return {
      currentPercent: 0,
      targetPercent: s.levels[0] / 100,
      growing: false,
      secondsToNextGrowth: s.graceSeconds - elapsed,
      secondsToTarget: 0,
      waveFlash: s.graceSeconds - elapsed <= 5,
      done: false,
    };
  }

  // Walk the per-wave ramp/pause segments to locate the current wave.
  let t = elapsed - s.graceSeconds;
  for (let i = 0; i < n; i++) {
    const ramp = s.rampSeconds[i];
    const pause = s.pauseSeconds[i];
    const isLast = i === n - 1;
    if (t < ramp) {
      return {
        currentPercent,
        targetPercent: s.levels[i] / 100,
        growing: true,
        secondsToNextGrowth: 0,
        secondsToTarget: ramp - t, // reaches this wave's level when the ramp ends
        waveFlash: t <= 5, // just started ramping
        done: false,
      };
    }
    t -= ramp;
    if (t < pause) {
      return {
        currentPercent,
        targetPercent: (isLast ? s.levels[i] : s.levels[i + 1]) / 100,
        growing: false,
        secondsToNextGrowth: isLast ? 0 : pause - t,
        secondsToTarget: 0,
        waveFlash: !isLast && pause - t <= 5, // next ramp imminent
        done: isLast,
      };
    }
    t -= pause;
  }
  return {
    currentPercent,
    targetPercent: last,
    growing: false,
    secondsToNextGrowth: 0,
    secondsToTarget: 0,
    waveFlash: false,
    done: true,
  };
}

export interface DoomsdayClockDrainConfig {
  drainStartPercent: number;
  drainMaxPercent: number;
  drainRampSeconds: number;
}

/** Upper bound (exclusive) of both rot noise fields, so callers share a scale. */
export const ROT_NOISE_SCALE = 1 << 16;

// R2 low-discrepancy lattice constants (inverse plastic-number powers) at 2^32.
const R2_X = 3242174889;
const R2_Y = 2447445413;

/**
 * Even, blue-noise-like per-tile value in [0, ROT_NOISE_SCALE): used to place
 * scattered pinholes. Taking the lowest values gives points that are near-evenly
 * spaced, where a plain hash clumps — measured on a 60x60 grid, 0% of picks touch
 * a neighbour here against 32% for white noise.
 *
 * Deliberately NOT avalanched: the evenness is the lattice being linear in x and
 * y, and hashing the result measures worse than white noise (36% touching).
 */
export function rotSpeckleNoise(x: number, y: number, salt: number): number {
  const h =
    (Math.imul(x, R2_X) + Math.imul(y, R2_Y) + Math.imul(salt, 0x9e3779b9)) >>>
    0;
  return (h >>> 16) % ROT_NOISE_SCALE;
}

/**
 * Unstructured per-tile value in [0, ROT_NOISE_SCALE): used to order the rot
 * front. This one MUST be hashed. The lattice above is striped, and ranking an
 * advancing front by it walks along a stripe and grows a straight 80x21 filament
 * instead of a shape.
 */
export function rotFrontNoise(tile: number, salt: number): number {
  let h = (Math.imul(tile, 0x27d4eb2d) ^ Math.imul(salt, 0x9e3779b9)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 16) % ROT_NOISE_SCALE;
}

export interface DoomsdayClockFloorConfig {
  /** Where the troop floor settles, as a percent of max (the long-run floor). */
  drainFloorPercent: number;
  /** Where the troop floor STARTS, as a percent of max, before it decays. */
  floorStartPercent: number;
  /** How long the floor takes to decay from the start down to drainFloorPercent. */
  floorDecaySeconds: number;
}

/**
 * Troop floor `secondsPastWarn` into the decay: linear from floorStartPercent down
 * to drainFloorPercent over floorDecaySeconds, flat after. Integer-only.
 */
export function doomsdayClockTroopFloor(
  maxTroops: number,
  secondsPastWarn: number,
  cfg: DoomsdayClockFloorConfig,
): number {
  const end = cfg.drainFloorPercent;
  const span = cfg.floorStartPercent - end;
  const t = Math.max(0, secondsPastWarn);
  const pct =
    span > 0 && cfg.floorDecaySeconds > 0 && t < cfg.floorDecaySeconds
      ? cfg.floorStartPercent - Math.floor((span * t) / cfg.floorDecaySeconds)
      : end;
  return Math.floor((maxTroops * pct) / 100);
}

// Fixed-point scale for the convex drain curve. (t/r)^exponent is evaluated as a
// fraction of this via repeated integer multiply, so the ramp never touches a
// float and lands bit-identically on every client in the lockstep sim.
const DRAIN_CURVE_SCALE = 1_000_000;

/**
 * (t/r)^exponent as a fraction of DRAIN_CURVE_SCALE, integer-only. Squares down
 * from 1.0 with a floored multiply per step; t <= r and exponent >= 2, so the
 * intermediates stay well inside Number.MAX_SAFE_INTEGER.
 */
function drainCurveFraction(t: number, r: number, exponent: number): number {
  const ratio = Math.floor((t * DRAIN_CURVE_SCALE) / r); // in [0, SCALE]
  let acc = DRAIN_CURVE_SCALE; // represents 1.0
  for (let i = 0; i < exponent; i++) {
    acc = Math.floor((acc * ratio) / DRAIN_CURVE_SCALE);
  }
  return acc;
}

/**
 * Troops (or warship health) a skulled side loses this second: a ramp from
 * drainStartPercent up to drainMaxPercent over drainRampSeconds, as a percentage
 * of MAX capacity/health (not current), so it outpaces income from the first
 * second. `curveExponent` shapes the ramp: 1 = LINEAR (troops → ~1:30 to zero
 * from full); >1 = CONVEX (warships → stays near the gentle start for most of the
 * ramp, then spikes hard, so a ship caught early lasts ~as long as troops but a
 * side at full attrition loses ships in ~2s). The caller caps it at the side's
 * current value. Integer-only and floored throughout — no floats — so the drain
 * is deterministic across clients (required by the lockstep sim).
 */
export function doomsdayClockDrain(
  maxTroops: number,
  secondsPastWarn: number,
  cfg: DoomsdayClockDrainConfig,
  curveExponent = 1,
): number {
  const t = Math.max(0, secondsPastWarn);
  const r = cfg.drainRampSeconds;
  const span = cfg.drainMaxPercent - cfg.drainStartPercent;
  let pct = cfg.drainMaxPercent;
  if (r > 0 && t < r) {
    // Linear is the exact integer form the sim has always used; the convex case
    // reshapes it through the fixed-point curve above (still integer-only).
    const grown =
      curveExponent <= 1
        ? Math.floor((span * t) / r)
        : Math.floor(
            (span * drainCurveFraction(t, r, curveExponent)) /
              DRAIN_CURVE_SCALE,
          );
    pct = cfg.drainStartPercent + grown;
  }
  return Math.max(1, Math.floor((maxTroops * pct) / 100));
}
