import { GameConfig, GameID, PartialGameRecord } from "../core/Schemas";
import { replacer } from "../core/Util";

export interface LocalStatsData {
  [key: GameID]: {
    lobby: Partial<GameConfig>;
    // Only once the game is over
    gameRecord?: PartialGameRecord;
  };
}

let _startTime: number;

function getStats(): LocalStatsData {
  try {
    const statsStr = localStorage.getItem("game-records");
    return statsStr ? JSON.parse(statsStr) : {};
  } catch {
    // Accessing localStorage throws in sandboxed iframes (e.g. gaming portals)
    // or when storage is disabled; treat as empty rather than crashing.
    return {};
  }
}

function save(stats: LocalStatsData) {
  // To execute asynchronously
  setTimeout(() => {
    try {
      localStorage.setItem("game-records", JSON.stringify(stats, replacer));
    } catch {
      // Storage unavailable (sandboxed iframe / disabled) — skip persistence.
    }
  }, 0);
}

// The user can quit the game anytime so better save the lobby as soon as the
// game starts.
export function startGame(id: GameID, lobby: Partial<GameConfig>) {
  _startTime = Date.now();
  const stats = getStats();
  stats[id] = { lobby };
  save(stats);
}

export function startTime() {
  return _startTime;
}

export function endGame(gameRecord: PartialGameRecord) {
  const stats = getStats();
  const gameStat = stats[gameRecord.info.gameID];

  if (!gameStat) {
    console.log("LocalPersistantStats: game not found");
    return;
  }

  gameStat.gameRecord = gameRecord;
  save(stats);
}
