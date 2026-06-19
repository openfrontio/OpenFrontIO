import { Gold } from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";

/**
 * Pure, deterministic tuning curves for Invasion Mode.
 *
 * All inputs are integer tick counts (10 ticks = 1 second, 600 ticks = 1
 * minute) measured from the moment the invasion begins (i.e. after the grace
 * period). There is a single, ever-escalating difficulty curve — the lobby
 * `Difficulty` setting deliberately does NOT influence the invasion. Every
 * function is side-effect free so it can be unit tested in isolation, and any
 * randomness is taken from a caller-provided seeded `PseudoRandom` to preserve
 * simulation determinism.
 */

const TICKS_PER_MINUTE = 600;

// Up to this many distinct invader nations exist at once; once the cap is hit
// they reuse existing nations (each fielding up to INVADER_BOAT_MAX boats)
// rather than spawning more.
export const MAX_INVADER_NATIONS = 12;
export const INVADER_BOAT_MAX = 3;

// Boat cadence: ~1 every 15s early, ramping down to the 2s floor by 20 min.
const BOAT_INTERVAL_START = 150; // 15s
const BOAT_INTERVAL_FLOOR = 20; // 2s — the hard cap from the spec
const BOAT_RAMP_TICKS = 20 * TICKS_PER_MINUTE; // reaches the floor at 20 min
const BOAT_RAMP_DELTA = BOAT_INTERVAL_START - BOAT_INTERVAL_FLOOR;

// Transport population follows a growth curve: a few thousand early,
// accelerating to ~350k by minute 20, then a slow linear climb forever after
// (the game never plateaus — it always gets harder).
const TROOPS_START = 3_000;
const TROOPS_AT_PEAK = 350_000; // reached at minute 20
const TROOPS_PEAK_TICKS = 20 * TICKS_PER_MINUTE;
const TROOPS_LINEAR_PER_MINUTE = 10_000; // growth past minute 20
const TROOPS_PER_WAVE_BONUS = 200; // each successive boat lands a touch more

// Per-nation starting gold follows a saturating (plateau) curve, independent of
// the lobby "starting gold" setting: a flat 250k early, climbing toward the 2m
// cap (~1m by minute 10). Captured wholesale when the nation is conquered, so
// later invaders are far richer prizes.
const GOLD_START = 250_000;
const GOLD_CAP = 2_000_000;
const GOLD_HALF_TICKS = 10 * TICKS_PER_MINUTE; // ~half the cap reached by min 10

// Missile escalation. Missiles begin one minute into the invasion and a single
// strike "package" (the highest tier that passes its roll) is launched per
// boat. Chances/counts ramp early then plateau; the relentless troop growth is
// what keeps the late game lethal. MIRVs are deliberately excluded — atom and
// hydrogen barrages alone carry the bombardment.
const STRIKE_START_TICKS = 1 * TICKS_PER_MINUTE;
const ATOM_CHANCE = 50; // constant % once strikes begin
const HYDROGEN_MAX_CHANCE = 12;
const HYDROGEN_MAX_COUNT = 3;
const ATOM_MAX_COUNT = 8;

export type InvasionNuke = "atom" | "hydrogen";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Integer linear interpolation of `v0`→`v1` as `elapsed` moves `t0`→`t1`,
 * clamped to the endpoints outside that window. Used to build the escalation
 * ramps without floating-point state.
 */
function ramp(
  elapsed: number,
  t0: number,
  v0: number,
  t1: number,
  v1: number,
): number {
  if (elapsed <= t0) return v0;
  if (elapsed >= t1) return v1;
  return v0 + Math.floor(((v1 - v0) * (elapsed - t0)) / (t1 - t0));
}

/** Ticks between transport launches at the given elapsed time. */
export function boatIntervalTicks(elapsedTicks: number): number {
  const t = clamp(elapsedTicks, 0, BOAT_RAMP_TICKS);
  return (
    BOAT_INTERVAL_START - Math.floor((BOAT_RAMP_DELTA * t) / BOAT_RAMP_TICKS)
  );
}

/**
 * Troop count carried by a transport. Accelerates from a few thousand to ~350k
 * over the first 20 minutes, then grows linearly forever. A small cumulative
 * bump per boat already sent makes each successive wave land slightly more.
 */
export function boatTroops(elapsedTicks: number, waveIndex = 0): number {
  const t = Math.max(0, elapsedTicks);
  let base: number;
  if (t <= TROOPS_PEAK_TICKS) {
    // Quadratic ease-in: slow at first, steepening toward the peak.
    base =
      TROOPS_START +
      Math.floor(
        ((TROOPS_AT_PEAK - TROOPS_START) * t * t) /
          (TROOPS_PEAK_TICKS * TROOPS_PEAK_TICKS),
      );
  } else {
    base =
      TROOPS_AT_PEAK +
      Math.floor(
        (TROOPS_LINEAR_PER_MINUTE * (t - TROOPS_PEAK_TICKS)) / TICKS_PER_MINUTE,
      );
  }
  return base + Math.max(0, waveIndex) * TROOPS_PER_WAVE_BONUS;
}

/** Starting gold handed to a freshly spawned invader nation. */
export function invaderStartingGold(elapsedTicks: number): Gold {
  const t = Math.max(0, elapsedTicks);
  // Saturating curve gold = cap * t / (t + k): GOLD_START at t=0, → GOLD_CAP.
  const value = Math.floor((GOLD_CAP * t) / (t + GOLD_HALF_TICKS));
  return BigInt(Math.max(GOLD_START, Math.min(GOLD_CAP, value)));
}

/**
 * Number of escort warships (0-3) accompanying a wave. Time-independent and
 * weighted very heavily toward 0 and 1 — 2 is uncommon and 3 is rare — so the
 * map is never flooded with warships, especially early on.
 */
export function warshipCount(random: PseudoRandom): number {
  const roll = random.nextInt(0, 100);
  if (roll < 55) return 0; // 55%
  if (roll < 88) return 1; // 33%
  if (roll < 97) return 2; // 9%
  return 3; // 3%
}

function atomCount(elapsedTicks: number): number {
  // 1 at minute 1 → 5 at minute 10, then +1 per 4 min, capped.
  let c = ramp(elapsedTicks, STRIKE_START_TICKS, 1, 10 * TICKS_PER_MINUTE, 5);
  if (elapsedTicks > 10 * TICKS_PER_MINUTE) {
    c =
      5 +
      Math.floor(
        (elapsedTicks - 10 * TICKS_PER_MINUTE) / (4 * TICKS_PER_MINUTE),
      );
  }
  return clamp(c, 1, ATOM_MAX_COUNT);
}

function hydrogenChance(elapsedTicks: number): number {
  // 5% at minute 1 → 10% at minute 10, then drifting up to the cap.
  let c = ramp(elapsedTicks, STRIKE_START_TICKS, 5, 10 * TICKS_PER_MINUTE, 10);
  if (elapsedTicks > 10 * TICKS_PER_MINUTE) {
    c =
      10 +
      Math.floor(
        (elapsedTicks - 10 * TICKS_PER_MINUTE) / (5 * TICKS_PER_MINUTE),
      );
  }
  return clamp(c, 0, HYDROGEN_MAX_CHANCE);
}

function hydrogenCount(elapsedTicks: number): number {
  // 1 at minute 1 → 2 at minute 10 → 3 by minute 20, capped.
  let c = ramp(elapsedTicks, STRIKE_START_TICKS, 1, 10 * TICKS_PER_MINUTE, 2);
  if (elapsedTicks > 10 * TICKS_PER_MINUTE) {
    c =
      2 +
      Math.floor(
        (elapsedTicks - 10 * TICKS_PER_MINUTE) / (10 * TICKS_PER_MINUTE),
      );
  }
  return clamp(c, 1, HYDROGEN_MAX_COUNT);
}

/**
 * The missile package launched by a single boat as it spawns, or an empty list
 * if it carries none. The higher tier that passes its roll wins: a small
 * hydrogen salvo, else an atom barrage. Returns concrete warhead types so the
 * caller can fire one execution each from the spawn tile.
 */
export function selectInvasionStrike(
  elapsedTicks: number,
  random: PseudoRandom,
): InvasionNuke[] {
  if (elapsedTicks < STRIKE_START_TICKS) return [];

  if (random.nextInt(0, 100) < hydrogenChance(elapsedTicks)) {
    return new Array<InvasionNuke>(hydrogenCount(elapsedTicks)).fill(
      "hydrogen",
    );
  }
  if (random.nextInt(0, 100) < ATOM_CHANCE) {
    return new Array<InvasionNuke>(atomCount(elapsedTicks)).fill("atom");
  }
  return [];
}
