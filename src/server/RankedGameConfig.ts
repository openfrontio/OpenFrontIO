import {
  Difficulty,
  Duos,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Quads,
  Trios,
} from "../core/game/Game";
import { GameConfig, TeamCountConfig } from "../core/Schemas";

export type MatchMode = "ffa" | "team" | "duel" | "duos" | "trios" | "quads";

export interface RankedMatchConfig {
  queueType: "ranked" | "unranked";
  gameMode: MatchMode;
  playerCount: number;
  teamConfig?: TeamCountConfig;
}

export function matchModeToGameMode(matchMode: MatchMode): GameMode {
  if (matchMode === "duel") return GameMode.Duel;
  if (matchMode === "ffa") return GameMode.FFA;
  return GameMode.Team;
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
  const isDuel = gameMode === "duel";
  const isFFA = gameMode === "ffa";
  const isTeamMode = !isDuel && !isFFA;
  const mode = matchModeToGameMode(gameMode);

  // Determine team configuration based on game mode
  let teamConfig: TeamCountConfig | undefined = matchConfig.teamConfig;
  if (gameMode === "duos") {
    teamConfig = Duos;
  } else if (gameMode === "trios") {
    teamConfig = Trios;
  } else if (gameMode === "quads") {
    teamConfig = Quads;
  }

  return {
    gameMap: map,
    gameMapSize: isDuel ? GameMapSize.Normal : selectMapSize(playerCount),
    gameType: GameType.Public,
    gameMode: mode,
    maxPlayers: playerCount,

    bots: 400,
    difficulty: Difficulty.Medium,
    disableNations: true,

    // Donation rules
    donateGold: isTeamMode,
    donateTroops: isTeamMode,

    // Standard settings
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: isFFA,
    maxTimerValue: undefined,

    // No disabled units in ranked
    disabledUnits: [],

    // Team configuration
    playerTeams: teamConfig,
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
