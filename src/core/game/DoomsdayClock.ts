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
  /** Flat 0% for this long at the very start (the one grace period). */
  graceSeconds: number;
  /** Each wave grows its share up linearly over this long. */
  rampSeconds: number;
  /** Flat hold after each ramp before the next one starts. */
  pauseSeconds: number;
  /** Share (basis points, 100 = 1%) reached at the end of each ramp, ascending. */
  levels: number[];
}

// Grace once, then a repeating cycle of [ramp up over rampSeconds] + [hold for
// pauseSeconds]. The share rises linearly during each ramp and is flat during
// the grace and every pause. Easy to tune: change grace, ramp, pause, or levels.
// Same levels everywhere (the ofstats FFA territory median, then a final 55%
// squeeze); the presets only change the pace. The median run is 3/5/10/20/30%;
// normal hits it dead on at 10/15/20/25/30 min. The 6th wave (55%) only one side
// can hold, so, together with the crown exemption, it forces out everyone but
// the leader for a single winner. slow is ~20% slower, fast ~30% faster, very
// fast 50% faster.
const LEVELS = [300, 500, 1000, 2000, 3000, 5500]; // 3, 5, 10, 20, 30, 55%
const SCHEDULES: Record<DoomsdayClockSpeed, WaveSchedule> = {
  // grace 5:30, 4:30 ramps + 30s pauses -> 3/5/10/20/30/55% at 10/15/20/25/30/35 min.
  normal: {
    graceSeconds: 330,
    rampSeconds: 270,
    pauseSeconds: 30,
    levels: LEVELS,
  },
  // grace 6:30, 5:30 ramps -> reaches at 12/18/24/30/36/42 min.
  slow: {
    graceSeconds: 390,
    rampSeconds: 330,
    pauseSeconds: 30,
    levels: LEVELS,
  },
  // grace 4:30, 2:50 ramps -> reaches at 7:20/10:40/14/17:20/20:40/24 min.
  fast: {
    graceSeconds: 270,
    rampSeconds: 170,
    pauseSeconds: 30,
    levels: LEVELS,
  },
  // grace 3:00, 2:00 ramps -> reaches at 5/7:30/10/12:30/15/17:30 min.
  veryfast: {
    graceSeconds: 180,
    rampSeconds: 120,
    pauseSeconds: 30,
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
  const cycle = s.rampSeconds + s.pauseSeconds;
  const t = elapsed - s.graceSeconds;
  const i = Math.floor(t / cycle);
  if (i >= s.levels.length) return s.levels[s.levels.length - 1];
  const into = t - i * cycle;
  const prev = i === 0 ? 0 : s.levels[i - 1];
  const target = s.levels[i];
  if (into >= s.rampSeconds) return target; // in the pause: hold
  return prev + Math.floor(((target - prev) * into) / s.rampSeconds);
}

/**
 * Base minimum tiles one player must own at `elapsed` game seconds. One floored
 * integer ratio, so every client agrees.
 */
export function doomsdayClockRequiredTiles(
  speed: DoomsdayClockSpeed,
  land: number,
  elapsed: number,
): number {
  if (land <= 0) return 0;
  return Math.floor((requiredBasisPoints(speed, elapsed) * land) / 10000);
}

/**
 * Threshold a whole side must hold: the base per-player share scaled by the
 * side's headcount, so a team of N must hold N× what a solo player holds (FFA
 * sides are size 1, i.e. unscaled). Capped at the whole map. Shared by the sim
 * and the HUD so the two always agree.
 */
export function doomsdayClockSideRequiredTiles(
  speed: DoomsdayClockSpeed,
  land: number,
  elapsed: number,
  sideSize: number,
): number {
  const base = doomsdayClockRequiredTiles(speed, land, elapsed);
  return Math.min(land, base * Math.max(1, sideSize));
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
  const cycle = s.rampSeconds + s.pauseSeconds;
  const n = s.levels.length;
  const last = s.levels[n - 1] / 100;

  // Grace: flat 0; the first ramp starts at graceSeconds.
  if (elapsed <= s.graceSeconds) {
    return {
      currentPercent: 0,
      targetPercent: s.levels[0] / 100,
      growing: false,
      secondsToNextGrowth: s.graceSeconds - elapsed,
      waveFlash: s.graceSeconds - elapsed <= 5,
      done: false,
    };
  }

  const t = elapsed - s.graceSeconds;
  const i = Math.floor(t / cycle);
  if (i >= n) {
    return {
      currentPercent,
      targetPercent: last,
      growing: false,
      secondsToNextGrowth: 0,
      waveFlash: false,
      done: true,
    };
  }

  const into = t - i * cycle;
  const growing = into < s.rampSeconds;
  const isLast = i === n - 1;
  const nextRampStart = s.graceSeconds + (i + 1) * cycle;
  return {
    currentPercent,
    targetPercent: (growing || isLast ? s.levels[i] : s.levels[i + 1]) / 100,
    growing,
    secondsToNextGrowth: growing || isLast ? 0 : nextRampStart - elapsed,
    // 5s into a ramp (just started) or 5s before the next ramp begins.
    waveFlash: into <= 5 || (!isLast && nextRampStart - elapsed <= 5),
    done: isLast && !growing,
  };
}

export interface DoomsdayClockDrainConfig {
  drainStartPercent: number;
  drainMaxPercent: number;
  drainRampSeconds: number;
}

/**
 * Troops a skulled side loses this second: a LINEAR ramp from drainStartPercent
 * up to drainMaxPercent over drainRampSeconds. It is a percentage of the side's
 * MAX troop capacity (not current), so it outpaces troop income from the first
 * second and accelerates as it grows, driving the side to zero in ~55s from full
 * troops (sooner with fewer troops or a shrinking territory). The caller caps it
 * at the side's current troops (removeTroops does, and the HUD shows
 * min(current, this)). Shared by the sim and the HUD.
 */
export function doomsdayClockDrain(
  maxTroops: number,
  secondsPastWarn: number,
  cfg: DoomsdayClockDrainConfig,
): number {
  const t = Math.max(0, secondsPastWarn);
  const r = cfg.drainRampSeconds;
  const span = cfg.drainMaxPercent - cfg.drainStartPercent;
  const pct =
    r <= 0 || t >= r
      ? cfg.drainMaxPercent
      : cfg.drainStartPercent + Math.floor((span * t) / r);
  return Math.max(1, Math.floor((maxTroops * pct) / 100));
}
