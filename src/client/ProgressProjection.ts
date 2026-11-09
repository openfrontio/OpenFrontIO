import type {
  GameXpEligible,
  Progress,
  ProgressionConfig,
} from "@openfront/shared/ApiSchemas";

// Where an amount of XP would take a player on the level track. Its own small
// module, without the XP formula, so the homepage can project the player's
// pending provisional XP (ProvisionalProgress.ts) without loading the formula
// that works it out at death (ProvisionalXpAtDeath.ts).

/**
 * Where `xp` would take the player on the level track: the API's applyXp,
 * with the level sizes from the config. Null when the config doesn't cover a
 * level it needs.
 */
export function projectProgress(
  progress: Progress,
  xp: number,
  config: ProgressionConfig,
): Pick<GameXpEligible, "before" | "after" | "levelsReached"> | null {
  const xpToNext = (level: number): number | undefined => {
    if (level >= config.maxLevel) return 0;
    const row = config.levels.find((l) => l.level === level);
    if (row !== undefined) return row.xpToNext;
    return level === progress.level ? progress.xpForNext : undefined;
  };
  const before = {
    prestige: progress.prestige,
    level: progress.level,
    xpInLevel: progress.xpInLevel,
    xpForNext: progress.xpForNext,
  };
  let { level, xpInLevel, legend } = progress;
  const levelsReached: { prestige: number; level: number }[] = [];
  if (xp > 0 && level < config.maxLevel) {
    xpInLevel += xp;
    while (level < config.maxLevel) {
      const need = xpToNext(level);
      if (need === undefined) return null;
      if (xpInLevel < need) break;
      xpInLevel -= need;
      level += 1;
      levelsReached.push({ prestige: progress.prestige, level });
    }
    if (level >= config.maxLevel) {
      xpInLevel = 0;
      legend = progress.prestige >= config.maxPrestige;
    }
  }
  const xpForNext = xpToNext(level);
  if (xpForNext === undefined) return null;
  return {
    before,
    after: {
      prestige: progress.prestige,
      level,
      xpInLevel,
      xpForNext,
      lifetimeXp: progress.lifetimeXp + Math.max(0, xp),
      legend,
      canPrestige:
        level >= config.maxLevel && progress.prestige < config.maxPrestige,
    },
    levelsReached,
  };
}
