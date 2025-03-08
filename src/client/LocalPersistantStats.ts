import { consolex } from "../core/Consolex";
import { PlayerID } from "../core/game/Game";
import { GameConfig, GameID, GameRecord } from "../core/Schemas";

export interface LocalStatsData {
  [key: GameID]: {
    playerId: PlayerID;
    lobby: GameConfig;
    // Only once the game is over
    gameRecord?: GameRecord;
  };
}

export namespace LocalPersistantStats {
  let _startTime: number;

  function getStats(): LocalStatsData {
    const statsStr = localStorage.getItem("game-records");
    return statsStr ? JSON.parse(statsStr) : {};
  }

  function save(stats: LocalStatsData) {
    // To execute asynchronously
    setTimeout(
      () => localStorage.setItem("game-records", JSON.stringify(stats)),
      0,
    );
  }

  // The user can quit the game anytime so better save the lobby as soon as the
  // game starts.
  export function startGame(id: GameID, playerId: PlayerID, lobby: GameConfig) {
    if (typeof localStorage === "undefined") {
      return;
    }

    _startTime = Date.now();
    const stats = getStats();
    stats[id] = { playerId, lobby };
    save(stats);
  }

  export function startTime() {
    return _startTime;
  }

  export function endGame(gameRecord: GameRecord) {
    if (typeof localStorage === "undefined") {
      return;
    }

    const stats = getStats();
    const gameStat = stats[gameRecord.id];

    if (!gameStat) {
      consolex.log("LocalPersistantStats: game not found");
      return;
    }

    gameStat.gameRecord = gameRecord;
    save(stats);
  }
}
