import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { GameConfig, TeamCountConfig } from "../core/Schemas";

export interface RankedMatchConfig {
  queueType: "ranked" | "unranked";
  gameMode: "ffa" | "team";
  playerCount: number;
  teamConfig?: unknown;
}

/**
 * Build a complete GameConfig for a ranked match
 * Uses the same bot rules as public games (400 bots)
 * Applies competitive settings appropriate for ranked play
 */
export function buildRankedGameConfig(
  map: GameMapType,
  matchConfig: RankedMatchConfig,
): GameConfig {
  const { gameMode, playerCount } = matchConfig;
  const mode = gameMode === "ffa" ? GameMode.FFA : GameMode.Team;

  return {
    gameMap: map,
    gameMapSize: selectMapSize(playerCount),
    gameType: GameType.Public,
    gameMode: mode,
    maxPlayers: playerCount,

    bots: 400,
    difficulty: Difficulty.Medium,
    disableNPCs: false,

    // Donation rules
    donateGold: mode === GameMode.Team,
    donateTroops: mode === GameMode.Team,

    // Standard settings
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    maxTimerValue: undefined,

    // No disabled units in ranked
    disabledUnits: [],

    // Team configuration
    playerTeams: matchConfig.teamConfig as TeamCountConfig | undefined,
  };
}

/**
 * Select appropriate map size based on player count
 * - Compact: 1-10 players
 * - Normal: 11+ players
 */
function selectMapSize(playerCount: number): GameMapSize {
  if (playerCount <= 10) {
    return GameMapSize.Compact;
  } else {
    return GameMapSize.Normal;
  }
}
