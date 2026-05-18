/**
 * game-constants.ts — Upstream game facts replicated in the renderer/shim.
 *
 * All values here are sourced from upstream game code. When upstream changes,
 * audit this file first.
 *
 * Primary sources:
 *   - vendor/openfront/src/core/configuration/DefaultConfig.ts  (DefaultConfig, DefaultServerConfig)
 *   - vendor/openfront/src/client/graphics/layers/FxLayer.ts    (visual-only constants)
 */

import {
  UT_ATOM_BOMB,
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_HYDROGEN_BOMB,
  UT_MIRV_WARHEAD,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_SAM_LAUNCHER,
} from "./types";

// ---------------------------------------------------------------------------
// Tick timing
// ---------------------------------------------------------------------------

/**
 * Milliseconds per game tick.
 * Source: DefaultServerConfig.turnIntervalMs() → return 100
 */
export const MS_PER_TICK = 100;

// ---------------------------------------------------------------------------
// Unit health
// ---------------------------------------------------------------------------

/**
 * Maximum health for a Warship unit.
 * Source: DefaultConfig.unitInfo(UnitType.Warship) → { maxHealth: 1000 }
 */
export const WARSHIP_MAX_HEALTH = 1000;

// ---------------------------------------------------------------------------
// Construction durations (ticks)
// ---------------------------------------------------------------------------

/**
 * How many ticks each structure type takes to finish construction.
 * Source: DefaultConfig.unitInfo(type).constructionDuration (non-instantBuild path):
 *   case UnitType.City:        constructionDuration: 2 * 10
 *   case UnitType.Port:        constructionDuration: 2 * 10
 *   case UnitType.Factory:     constructionDuration: 2 * 10
 *   case UnitType.DefensePost: constructionDuration: 5 * 10
 *   case UnitType.MissileSilo: constructionDuration: 10 * 10
 *   case UnitType.SAMLauncher: constructionDuration: 30 * 10
 */
export const CONSTRUCTION_DURATIONS: Readonly<Record<string, number>> = {
  [UT_CITY]: 2 * 10,
  [UT_PORT]: 2 * 10,
  [UT_FACTORY]: 2 * 10,
  [UT_DEFENSE_POST]: 5 * 10,
  [UT_MISSILE_SILO]: 10 * 10,
  [UT_SAM_LAUNCHER]: 30 * 10,
};

// ---------------------------------------------------------------------------
// Missile cooldowns (ticks)
// ---------------------------------------------------------------------------

/**
 * Ticks for a SAM Launcher to reload one missile.
 * Source: DefaultConfig.SAMCooldown() → return 120
 * NOTE: different from SiloCooldown — do not conflate.
 */
export const SAM_COOLDOWN_TICKS = 120;

/**
 * Ticks for a Missile Silo to reload one missile.
 * Source: DefaultConfig.SiloCooldown() → return 75
 */
export const SILO_COOLDOWN_TICKS = 75;

// ---------------------------------------------------------------------------
// Deletion mark duration (ticks)
// ---------------------------------------------------------------------------

/**
 * How many ticks a structure remains in the "marked for deletion" state.
 * Source: DefaultConfig.deletionMarkDuration() → return 30 * 10
 */
export const DELETION_MARK_DURATION = 30 * 10;

// ---------------------------------------------------------------------------
// Nuke explosion visual radii (tiles)
// ---------------------------------------------------------------------------

/**
 * Visual explosion radius (tiles) for each nuke type, used for shockwave and
 * debris scatter sizing.
 *
 * Source: FxLayer.ts, inside the unit-death event handler:
 *   case UnitType.AtomBomb:    this.onNukeEvent(unit, 70)
 *   case UnitType.MIRVWarhead: this.onNukeEvent(unit, 70)
 *   case UnitType.HydrogenBomb: this.onNukeEvent(unit, 160)
 *
 * Note: these are visual-only radii. The gameplay damage radii are separate
 * and come from DefaultConfig.nukeMagnitudes() → { inner, outer }.
 */
export const NUKE_EXPLOSION_RADII: Readonly<Record<string, number>> = {
  [UT_ATOM_BOMB]: 70,
  [UT_HYDROGEN_BOMB]: 160,
  [UT_MIRV_WARHEAD]: 70,
};

// ---------------------------------------------------------------------------
// SAM range formula
// ---------------------------------------------------------------------------

/**
 * SAM Launcher coverage radius in tiles at a given upgrade level.
 * Source: DefaultConfig.samRange(level):
 *   return this.maxSamRange() - 480 / (level + 5)
 *   where maxSamRange() → return 150
 */
export function samRange(level: number): number {
  return 150 - 480 / (level + 5);
}

// ---------------------------------------------------------------------------
// Missile readiness formula
// ---------------------------------------------------------------------------

/**
 * Fractional missile readiness [0, 1] for a Silo or SAM Launcher.
 * Returns 1.0 when fully loaded, 0.0 when completely empty with no partial reload.
 *
 * Source: adapted from upstream readiness display logic (UILayer / FxLayer).
 * Uses per-type cooldown: SAMCooldown() = 120, SiloCooldown() = 75.
 */
export function missileReadiness(
  unitType: string,
  level: number,
  missileTimerQueue: number[],
  gameTick: number,
): number {
  const cooldown =
    unitType === UT_SAM_LAUNCHER ? SAM_COOLDOWN_TICKS : SILO_COOLDOWN_TICKS;
  const maxMissiles = level;
  const reloading = missileTimerQueue.length;
  if (reloading === 0) return 1;

  const ready = maxMissiles - reloading;
  if (ready === 0 && maxMissiles > 1) return 0;

  let readiness = ready / maxMissiles;
  for (const timer of missileTimerQueue) {
    const progress = gameTick - timer;
    const ratio = progress / cooldown;
    readiness += ratio / maxMissiles;
  }
  return Math.max(0, Math.min(1, readiness));
}
