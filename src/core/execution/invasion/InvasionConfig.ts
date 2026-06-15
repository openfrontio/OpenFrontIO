import { Difficulty } from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { assertNever } from "../../Util";

/**
 * Pure, deterministic tuning curves for Invasion Mode.
 *
 * All inputs are integer tick counts (10 ticks = 1 second, 600 ticks = 1
 * minute) measured from the moment the invasion begins (i.e. after the grace
 * period). Intensity escalates with time and is further scaled by the lobby
 * `Difficulty`. Every function is side-effect free so it can be unit tested in
 * isolation, and any randomness is taken from a caller-provided seeded
 * `PseudoRandom` to preserve simulation determinism.
 */

const TICKS_PER_MINUTE = 600;

// Boat cadence: ~1 every 15s early, ramping down to the 2s floor by 20 min.
const BOAT_INTERVAL_START = 150; // 15s
const BOAT_INTERVAL_FLOOR = 20; // 2s — the hard cap from the spec
const BOAT_RAMP_TICKS = 20 * TICKS_PER_MINUTE; // reaches the floor at 20 min
const BOAT_RAMP_DELTA = BOAT_INTERVAL_START - BOAT_INTERVAL_FLOOR;

// Transport population: starts at 30k, grows with time and difficulty.
const TROOPS_START = 30_000;
const TROOPS_GROWTH_PER_MINUTE = 8_000;
const TROOPS_CAP = 350_000;

// Escalation onsets (before difficulty time-shift).
const WARSHIP_START_TICKS = 2 * TICKS_PER_MINUTE; // minute 2
const ATOM_TICKS = 4 * TICKS_PER_MINUTE; // minute 4
const HYDROGEN_TICKS = 10 * TICKS_PER_MINUTE; // minute 10
const MIRV_TICKS = 20 * TICKS_PER_MINUTE; // minute 20
const WARSHIP_PRESSURE_SPAN = 13 * TICKS_PER_MINUTE; // ramps from min 2 to 15
const MIRV_CHANCE_ODDS = 10; // 10% per eligible bomb

// Scheduled bombardment cadence once nukes are unlocked.
const BOMB_INTERVAL_START = 350; // 35s
const BOMB_INTERVAL_FLOOR = 120; // 12s

export type InvasionNukeTier = "none" | "atom" | "hydrogen" | "mirv";
export type InvasionNuke = "atom" | "hydrogen" | "mirv";

/** Intensity multiplier (percent) applied to wave size/cadence by difficulty. */
function difficultyIntensity(difficulty: Difficulty): number {
  switch (difficulty) {
    case Difficulty.Easy:
      return 70;
    case Difficulty.Medium:
      return 100;
    case Difficulty.Hard:
      return 130;
    case Difficulty.Impossible:
      return 160;
    default:
      assertNever(difficulty);
  }
}

/** Per-trial warship probability bonus (percentage points) by difficulty. */
function difficultyWarshipBonus(difficulty: Difficulty): number {
  switch (difficulty) {
    case Difficulty.Easy:
      return -10;
    case Difficulty.Medium:
      return 0;
    case Difficulty.Hard:
      return 10;
    case Difficulty.Impossible:
      return 20;
    default:
      assertNever(difficulty);
  }
}

/** How much earlier (in ticks) nukes unlock on higher difficulties. */
function difficultyTimeShiftTicks(difficulty: Difficulty): number {
  switch (difficulty) {
    case Difficulty.Easy:
      return TICKS_PER_MINUTE; // 1 min later
    case Difficulty.Medium:
      return 0;
    case Difficulty.Hard:
      return -TICKS_PER_MINUTE; // 1 min earlier
    case Difficulty.Impossible:
      return -2 * TICKS_PER_MINUTE; // 2 min earlier
    default:
      assertNever(difficulty);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Ticks between transport launches at the given elapsed time/difficulty. */
export function boatIntervalTicks(
  elapsedTicks: number,
  difficulty: Difficulty,
): number {
  const t = clamp(elapsedTicks, 0, BOAT_RAMP_TICKS);
  const base =
    BOAT_INTERVAL_START - Math.floor((BOAT_RAMP_DELTA * t) / BOAT_RAMP_TICKS);
  const scaled = Math.round((base * 100) / difficultyIntensity(difficulty));
  return Math.max(BOAT_INTERVAL_FLOOR, scaled);
}

/** Troop count carried by a transport launched at the given elapsed time. */
export function boatTroops(
  elapsedTicks: number,
  difficulty: Difficulty,
): number {
  const minutesTimesGrowth = Math.floor(
    (TROOPS_GROWTH_PER_MINUTE * Math.max(0, elapsedTicks)) / TICKS_PER_MINUTE,
  );
  const scaledGrowth = Math.floor(
    (minutesTimesGrowth * difficultyIntensity(difficulty)) / 100,
  );
  return Math.min(TROOPS_CAP, TROOPS_START + scaledGrowth);
}

/**
 * Number of escort warships (0-3) accompanying a wave. Always 0 before minute
 * 2; afterward the count is weighted toward fewer early and toward 3 later,
 * shifted by difficulty.
 */
export function warshipCount(
  elapsedTicks: number,
  random: PseudoRandom,
  difficulty: Difficulty,
): number {
  if (elapsedTicks < WARSHIP_START_TICKS) {
    return 0;
  }
  const pressure = clamp(
    Math.floor(
      ((elapsedTicks - WARSHIP_START_TICKS) * 90) / WARSHIP_PRESSURE_SPAN,
    ),
    0,
    90,
  );
  const threshold = clamp(pressure + difficultyWarshipBonus(difficulty), 5, 95);
  let count = 0;
  for (let i = 0; i < 3; i++) {
    if (random.nextInt(0, 100) < threshold) {
      count++;
    }
  }
  return count;
}

/** Highest weapon tier unlocked at the given elapsed time/difficulty. */
export function nukeTier(
  elapsedTicks: number,
  difficulty: Difficulty,
): InvasionNukeTier {
  const shift = difficultyTimeShiftTicks(difficulty);
  if (elapsedTicks >= MIRV_TICKS + shift) return "mirv";
  if (elapsedTicks >= HYDROGEN_TICKS + shift) return "hydrogen";
  if (elapsedTicks >= ATOM_TICKS + shift) return "atom";
  return "none";
}

/**
 * Picks the concrete weapon to launch for a scheduled bombardment, or null if
 * nukes are not yet unlocked. MIRVs are a 10% roll once eligible; otherwise a
 * hydrogen/atom mix weighted to the unlocked tier.
 */
export function selectInvasionNuke(
  elapsedTicks: number,
  random: PseudoRandom,
  difficulty: Difficulty,
): InvasionNuke | null {
  const tier = nukeTier(elapsedTicks, difficulty);
  switch (tier) {
    case "none":
      return null;
    case "atom":
      return "atom";
    case "hydrogen":
      return random.chance(3) ? "atom" : "hydrogen";
    case "mirv":
      if (random.chance(MIRV_CHANCE_ODDS)) return "mirv";
      return random.chance(3) ? "atom" : "hydrogen";
    default:
      assertNever(tier);
  }
}

/** Ticks between scheduled bombardments once nukes are unlocked. */
export function bombIntervalTicks(
  elapsedTicks: number,
  difficulty: Difficulty,
): number {
  const minutes = Math.floor(elapsedTicks / TICKS_PER_MINUTE);
  const base = Math.max(
    BOMB_INTERVAL_FLOOR,
    BOMB_INTERVAL_START - 10 * minutes,
  );
  return Math.max(
    BOMB_INTERVAL_FLOOR,
    Math.round((base * 100) / difficultyIntensity(difficulty)),
  );
}
