import { GameConfig, GameID, PartialGameRecord } from "../core/Schemas";
import { replacer } from "../core/Util";
import {
  getUiSessionStorageCachedValue,
  writeUiSessionStorage,
} from "./runtime/UiSessionRuntime";

export interface LocalStatsData {
  [key: GameID]: {
    lobby: Partial<GameConfig>;
    // Only once the game is over
    gameRecord?: PartialGameRecord;
  };
}

let _startTime: number;
const GAME_RECORDS_STORAGE_KEY = "game-records";

function getStats(): LocalStatsData {
  const statsStr = getUiSessionStorageCachedValue(GAME_RECORDS_STORAGE_KEY);
  if (typeof statsStr !== "string") {
    return {};
  }
  return statsStr ? JSON.parse(statsStr) : {};
}

function save(stats: LocalStatsData) {
  // To execute asynchronously
  setTimeout(
    () =>
      void writeUiSessionStorage(
        GAME_RECORDS_STORAGE_KEY,
        JSON.stringify(stats, replacer),
      ),
    0,
  );
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
