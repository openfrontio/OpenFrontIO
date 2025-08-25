import { z } from "zod";
import { ID } from "../core/BaseSchemas";
import {
  GameConfig,
  GameConfigSchema,
  GameID,
  GameRecord,
  GameRecordSchema,
} from "../core/Schemas";
import { replacer } from "../core/Util";

const LocalStatsDataSchema = z.record(
  ID,
  z.object({
    // Only once the game is over
    gameRecord: GameRecordSchema.optional(),
    lobby: GameConfigSchema.partial(),
  }),
);
type LocalStatsData = z.infer<typeof LocalStatsDataSchema>;

let _startTime: number | undefined;

function getStats(): LocalStatsData {
  try {
    return LocalStatsDataSchema.parse(
      JSON.parse(localStorage.getItem("game-records") ?? "{}"),
    );
  } catch (e) {
    return {};
  }
}

function save(stats: LocalStatsData) {
  // To execute asynchronously
  setTimeout(
    () => localStorage.setItem("game-records", JSON.stringify(stats, replacer)),
    0,
  );
}

// The user can quit the game anytime so better save the lobby as soon as the
// game starts.
export function startGame(id: GameID, lobby: Partial<GameConfig>) {
  if (localStorage === undefined) {
    return;
  }

  _startTime = Date.now();
  const stats = getStats();
  stats[id] = { lobby };
  save(stats);
}

export function startTime() {
  return _startTime;
}

export function endGame(gameRecord: GameRecord) {
  if (localStorage === undefined) {
    return;
  }

  const stats = getStats();
  const gameStat = stats[gameRecord.info.gameID];

  if (!gameStat) {
    console.log("LocalPersistantStats: game not found");
    return;
  }

  gameStat.gameRecord = gameRecord;
  save(stats);
}
