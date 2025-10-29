/* Centralized rules for Nuke Wars gamemode */
import { GameMapType, GameMode, TeamGameType } from "../game/Game";
import { UnitType } from "../units/UnitType";

export const NukeWarsConstants = {
  PREP_DURATION_MINUTES: 3,
  LOSS_TERRITORY_THRESHOLD_PERCENT: 5,
  SAM_INTERCEPT: new Map<UnitType, number>([
    [UnitType.AtomBomb, 1.0],
    [UnitType.HydrogenBomb, 0.8],
  ]),
};

export function isNukeWars(
  gameMode: GameMode,
  teamGameType?: TeamGameType,
): boolean {
  return gameMode === GameMode.Team && teamGameType === TeamGameType.NukeWars;
}

export function isBaikal(gameMap: GameMapType): boolean {
  return gameMap === GameMapType.Baikal;
}

// Updated per request: Only block MIRV. Everything else allowed subject to other spatial/phase rules.
export function isAllowedUnit(unit: UnitType): boolean {
  return unit !== UnitType.MIRV;
}

export function isMissileAllowedToCrossMidpoint(unit: UnitType): boolean {
  return unit === UnitType.AtomBomb || unit === UnitType.HydrogenBomb; // MIRV blocked above
}

export function getSamInterceptChance(unit: UnitType): number | undefined {
  return NukeWarsConstants.SAM_INTERCEPT.get(unit);
}
