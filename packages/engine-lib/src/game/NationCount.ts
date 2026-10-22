import {
  GameMapSize,
  GameMode,
  GameType,
  HumansVsNations,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";

/**
 * How many nations createNationsForGame (engine NationCreation.ts) makes for
 * this config, without making them, so code outside the simulation can size
 * teams the way the game does. Keep the two in step: NationCreation.test.ts
 * checks they agree.
 */
export function nationCountForGame(
  config: GameConfig,
  manifestNationCount: number,
  numHumans: number,
): number {
  if (config.nations === "disabled") {
    return 0;
  }
  if (typeof config.nations === "number") {
    return config.nations;
  }
  if (config.gameType === GameType.Public) {
    if (
      config.gameMode === GameMode.Team &&
      config.playerTeams === HumansVsNations
    ) {
      return numHumans;
    }
    if (config.gameMapSize === GameMapSize.Compact) {
      return getCompactMapNationCount(manifestNationCount, true);
    }
  }
  return manifestNationCount;
}

// For compact maps, only 25% of nations are used (minimum 1).
export function getCompactMapNationCount(
  manifestNationCount: number,
  isCompactMap: boolean,
): number {
  if (manifestNationCount === 0) {
    return 0;
  }
  if (isCompactMap) {
    return Math.max(1, Math.floor(manifestNationCount * 0.25));
  }
  return manifestNationCount;
}
