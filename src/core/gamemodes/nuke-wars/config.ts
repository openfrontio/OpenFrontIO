/* Nuke Wars centralized configuration
   Source of truth for constants and runtime-config defaults.
   See docs/gamemodes/nuke-wars.md */

import { GameMapType } from "../../game/Game";

// Allowed preparation times (seconds) at 30-second increments from 1 to 5 minutes.
export const PREP_ALLOWED_SECONDS: readonly number[] = [
  60, 90, 120, 150, 180, 210, 240, 270, 300,
] as const;

export const DEFAULT_PREP_SECONDS = 180;

export const FORCED_TEAM_COUNT = 2; // Nuke Wars is always 2 teams
export const MAP_LOCK = GameMapType.Baikal; // Nuke Wars only on Baikal

// SAM interception rates per weapon type key (Game UnitType names expected at call-sites)
export const INTERCEPT_RATES: Readonly<Record<string, number>> = {
  AtomBomb: 1.0,
  HydrogenBomb: 0.8,
};

// Defeat condition when territory control drops below this fraction
export const TERRITORY_DEFEAT_THRESHOLD = 0.05;

export function normalizePrepSeconds(value: number | undefined | null): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_PREP_SECONDS;
  // Clamp to the nearest allowed step
  let best = PREP_ALLOWED_SECONDS[0];
  let bestDelta = Math.abs(value - best);
  for (const v of PREP_ALLOWED_SECONDS) {
    const d = Math.abs(value - v);
    if (d < bestDelta) {
      best = v;
      bestDelta = d;
    }
  }
  return best;
}
