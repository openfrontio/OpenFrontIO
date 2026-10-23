import {
  GameMapSize,
  GameMode,
  GameType,
  HumansVsNations,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";

// Which nations a game gets: the rules createNationsForGame (engine
// NationCreation.ts) follows, here so code outside the simulation can count
// them the same way (nationCountForGame).
export type NationPick =
  // No nations.
  | { kind: "none" }
  // Every manifest nation, in manifest order.
  | { kind: "manifest" }
  // `count` nations drawn at random from the manifest, topped up from the
  // map's additional nations and then generated names when it has too few.
  | { kind: "random"; count: number };

// If config.nations is a number (custom count), uses that exact count.
// If config.nations is "disabled", no nations.
// If config.nations is "default":
//   - Public HumansVsNations: matches nation count to human player count
//   - Public compact maps: uses 25% of manifest nations (minimum 1)
//   - Otherwise: uses all manifest nations
export function nationPickForGame(
  config: GameConfig,
  manifestNationCount: number,
  numHumans: number,
): NationPick {
  if (config.nations === "disabled") {
    return { kind: "none" };
  }
  if (typeof config.nations === "number") {
    return { kind: "random", count: config.nations };
  }
  if (config.gameType === GameType.Public) {
    if (
      config.gameMode === GameMode.Team &&
      config.playerTeams === HumansVsNations
    ) {
      return { kind: "random", count: numHumans };
    }
    if (config.gameMapSize === GameMapSize.Compact) {
      return {
        kind: "random",
        count: compactMapNationCount(manifestNationCount),
      };
    }
  }
  return { kind: "manifest" };
}

// How many nations the game gets (see nationPickForGame).
export function nationCountForGame(
  config: GameConfig,
  manifestNationCount: number,
  numHumans: number,
): number {
  const pick = nationPickForGame(config, manifestNationCount, numHumans);
  switch (pick.kind) {
    case "none":
      return 0;
    case "manifest":
      return manifestNationCount;
    case "random":
      return pick.count;
  }
}

function compactMapNationCount(manifestNationCount: number): number {
  if (manifestNationCount === 0) {
    return 0;
  }
  return Math.max(1, Math.floor(manifestNationCount * 0.25));
}
