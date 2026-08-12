/**
 * Pure math mirrors of the simulation formulas the trainer teaches
 * (Config.troopIncreaseRate / maxTroops / attackLogic / attackTilesPerTick).
 *
 * These are display-side predictions only — nothing here mutates game state.
 * Parity with the real Config is enforced by tests/TrainerMath.test.ts; if a
 * formula changes in Config.ts, update the mirror here and the docs in
 * docs/TrainerMath.md.
 */

import { sigmoid, within } from "../../core/Util";

// Mirrors the private constants in src/core/configuration/Config.ts.
const DEFENSE_DEBUFF_MIDPOINT = 150_000;
const DEFENSE_DEBUFF_DECAY_RATE = Math.LN2 / 50000;

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

/** Troops gained next tick for a human player (no bot/nation multipliers). */
export function growthPerTick(troops: number, maxTroops: number): number {
  if (maxTroops <= 0) return 0;
  const toAdd = (10 + Math.pow(troops, 0.73) / 4) * (1 - troops / maxTroops);
  return Math.min(troops + toAdd, maxTroops) - troops;
}

/**
 * Troop count that maximizes growthPerTick, found by ternary search — the
 * curve is unimodal on [0, max]. Analytically ≈ 0.422 · max for large max
 * (the +10 base shifts it slightly for tiny players).
 */
export function optimalTroops(maxTroops: number): number {
  if (maxTroops <= 0) return 0;
  let lo = 0;
  let hi = maxTroops;
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (growthPerTick(m1, maxTroops) < growthPerTick(m2, maxTroops)) {
      lo = m1;
    } else {
      hi = m2;
    }
  }
  return (lo + hi) / 2;
}

/** growth now ÷ growth at the optimum, in [0, 1]. */
export function growthEfficiency(troops: number, maxTroops: number): number {
  const peak = growthPerTick(optimalTroops(maxTroops), maxTroops);
  if (peak <= 0) return 0;
  return within(growthPerTick(troops, maxTroops) / peak, 0, 1);
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export interface TerrainProfile {
  /** Loss magnitude: 80 plains, 100 highland, 120 mountain. */
  mag: number;
  /** Speed cost: 16.5 plains, 20 highland, 25 mountain. */
  speed: number;
}

export const TERRAIN_PLAINS: TerrainProfile = { mag: 80, speed: 16.5 };
export const TERRAIN_HIGHLAND: TerrainProfile = { mag: 100, speed: 20 };
export const TERRAIN_MOUNTAIN: TerrainProfile = { mag: 120, speed: 25 };

export interface CombatSituation {
  /** Troops committed to the attack. */
  attackTroops: number;
  /** Defender's current total troops. */
  defenderTroops: number;
  /** Defender's current tile count. */
  defenderTiles: number;
  /** Attacker's tile count (large-attacker debuffs kick in above 100k). */
  attackerTiles: number;
  terrain: TerrainProfile;
  /** Tile is covered by a defender defense post (mag ×5, speed ×3). */
  defensePost?: boolean;
  /** Human/Nation attacking a Bot (mag ×0.7). */
  humanVsBot?: boolean;
  /** Defender is a marked traitor (mag ×0.5, speed ×0.8). */
  traitor?: boolean;
}

/**
 * The clamp at the heart of attack sizing: committing ≥ 1/0.6 ≈ 1.667× the
 * defender's troops bottoms attacker losses out; committing ≤ 0.5× maxes
 * them at 3.33× the minimum.
 */
export const MIN_LOSS_COMMIT_FACTOR = 1 / 0.6;

/** Smallest commit that reaches minimum per-tile losses against D troops. */
export function minLossCommit(defenderTroops: number): number {
  return defenderTroops * MIN_LOSS_COMMIT_FACTOR;
}

/** Mirrors Config.attackLogic for a defended (player-owned) tile. */
export function attackLossesPerTile(s: CombatSituation): {
  attackerLoss: number;
  defenderLoss: number;
  speedCost: number;
} {
  let mag = s.terrain.mag;
  let speed = s.terrain.speed;
  if (s.defensePost) {
    mag *= 5;
    speed *= 3;
  }
  if (s.humanVsBot) {
    mag *= 0.7;
  }

  const defenseSig =
    1 -
    sigmoid(s.defenderTiles, DEFENSE_DEBUFF_DECAY_RATE, DEFENSE_DEBUFF_MIDPOINT);
  const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
  const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

  let largeAttackBonus = 1;
  let largeAttackerSpeedBonus = 1;
  if (s.attackerTiles > 100_000) {
    largeAttackBonus = Math.sqrt(100_000 / s.attackerTiles) ** 0.7;
    largeAttackerSpeedBonus = (100_000 / s.attackerTiles) ** 0.6;
  }

  const traitorMod = s.traitor ? 0.5 : 1;
  const defenderLoss = s.defenderTroops / Math.max(1, s.defenderTiles);
  const currentAttackerLoss =
    within(s.defenderTroops / Math.max(1, s.attackTroops), 0.6, 2) *
    mag *
    0.8 *
    largeDefenderAttackDebuff *
    largeAttackBonus *
    traitorMod;
  const altAttackerLoss = 1.3 * defenderLoss * (mag / 100) * traitorMod;

  return {
    attackerLoss: 0.6 * currentAttackerLoss + 0.4 * altAttackerLoss,
    defenderLoss,
    speedCost:
      within(s.defenderTroops / (5 * Math.max(1, s.attackTroops)), 0.2, 1.5) *
      speed *
      largeDefenderSpeedDebuff *
      largeAttackerSpeedBonus *
      (s.traitor ? 0.8 : 1),
  };
}

/** Mirrors Config.attackTilesPerTick (the per-tick conquest budget). */
export function conquestBudgetPerTick(
  attackTroops: number,
  defenderTroops: number,
  borderSize: number,
): number {
  return (
    within(
      ((5 * attackTroops) / Math.max(1, defenderTroops)) * 2,
      0.01,
      0.5,
    ) *
    borderSize *
    3
  );
}

export interface AttackForecast {
  /** Tiles conquered before the attacking force is spent (or all of them). */
  tilesTaken: number;
  /** Troops the attacker loses in total. */
  attackerLosses: number;
  /** Troops the defender loses in total. */
  defenderLosses: number;
  /** True if the whole defender territory falls. */
  conquered: boolean;
  /** Rough duration in seconds, using the speed-budget formulas. */
  seconds: number;
  /**
   * Losses the attack WOULD cost if sized at the min-loss commit
   * (same tiles taken, per-tile losses at the clamp floor).
   */
  minPossibleLosses: number;
}

/**
 * Tile-by-tile forecast of an attack, mirroring the AttackExecution loop:
 * each conquered tile costs the attacker attackLossesPerTile and drains the
 * defender's density; the defender's density rises as their land shrinks.
 * Batched so huge territories stay O(steps).
 */
export function forecastAttack(
  s: CombatSituation,
  borderSize: number = 20,
  steps: number = 400,
): AttackForecast {
  let a = s.attackTroops;
  let d = s.defenderTroops;
  let tiles = Math.max(1, Math.floor(s.defenderTiles));
  const batch = Math.max(1, Math.ceil(tiles / steps));

  let tilesTaken = 0;
  let attackerLosses = 0;
  let defenderLosses = 0;
  let minPossibleLosses = 0;
  let ticks = 0;

  while (a > 1 && tiles > 0) {
    const n = Math.min(batch, tiles);
    const losses = attackLossesPerTile({
      ...s,
      attackTroops: a,
      defenderTroops: d,
      defenderTiles: tiles,
    });
    const floorLosses = attackLossesPerTile({
      ...s,
      // Sized exactly at the clamp floor for this defender state.
      attackTroops: Math.max(minLossCommit(d), 1),
      defenderTroops: d,
      defenderTiles: tiles,
    });

    const budget = conquestBudgetPerTick(a, d, borderSize);
    if (budget > 0) {
      ticks += (n * losses.speedCost) / budget;
    }

    const affordable = Math.min(n, Math.floor(a / Math.max(losses.attackerLoss, 1e-9)));
    const take = Math.max(0, affordable);
    if (take === 0) break;

    attackerLosses += take * losses.attackerLoss;
    minPossibleLosses += take * floorLosses.attackerLoss;
    const defLoss = Math.min(d, take * losses.defenderLoss);
    defenderLosses += defLoss;
    a -= take * losses.attackerLoss;
    d -= defLoss;
    tiles -= take;
    tilesTaken += take;
  }

  return {
    tilesTaken,
    attackerLosses,
    defenderLosses,
    conquered: tiles === 0,
    seconds: ticks / 10,
    minPossibleLosses,
  };
}

// ---------------------------------------------------------------------------
// Wildlands (terra nullius) expansion
// ---------------------------------------------------------------------------

/** Troops at which wildland expansion speed saturates (cost clamp floor). */
export function wildlandsSaturationTroops(terrain: TerrainProfile): number {
  return (2000 * Math.max(10, terrain.speed)) / 5;
}

/** Per-tile speed cost of expanding into unowned land. */
export function wildlandsSpeedCost(
  attackTroops: number,
  terrain: TerrainProfile,
): number {
  return within(
    (2000 * Math.max(10, terrain.speed)) / Math.max(1, attackTroops),
    5,
    100,
  );
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export type Grade = "S" | "A" | "B" | "C" | "D" | "F";

/**
 * Grade an attack by how close its losses came to the theoretical minimum
 * (1.0 = perfectly sized). The clamp makes 3.33× the worst possible ratio,
 * so F starts at 2.5×.
 */
export function gradeAttack(
  actualLosses: number,
  minPossibleLosses: number,
): Grade {
  if (minPossibleLosses <= 0) return "S";
  const ratio = actualLosses / minPossibleLosses;
  if (ratio <= 1.05) return "S";
  if (ratio <= 1.2) return "A";
  if (ratio <= 1.5) return "B";
  if (ratio <= 2.0) return "C";
  if (ratio <= 2.5) return "D";
  return "F";
}

/** Commit verdict for the attack planner. */
export type CommitVerdict = "undercommit" | "efficient" | "overkill";

export function commitVerdict(
  attackTroops: number,
  defenderTroops: number,
): CommitVerdict {
  const floor = minLossCommit(defenderTroops);
  if (attackTroops < floor) return "undercommit";
  // Beyond 2.5× the defender's troops buys nothing the 1.667× commit didn't.
  if (attackTroops > defenderTroops * 2.5) return "overkill";
  return "efficient";
}
