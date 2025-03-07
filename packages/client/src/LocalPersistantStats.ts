import { consolex } from "../core/Consolex";
import { Difficulty, GameMapType, GameType } from "../core/game/Game";
import { PlayerStats } from "../core/game/Stats";
import { ClientID, GameID } from "../core/Schemas";
import { LobbyConfig } from "./ClientGameRunner";

export interface GameStat {
  lobby: {
    clientID: ClientID;
    persistentID: string;
    map: GameMapType | null;
    gameType: GameType;
    difficulty: Difficulty | null;
    infiniteGold: boolean | null;
    infiniteTroops: boolean | null;
    instantBuild: boolean | null;
    bots: number | null;
    disableNPCs: boolean | null;
  };
  playerStats?: PlayerStats;
  outcome?: "victory" | "defeat";
}

export class PersistantStats {
  // Can be used to handle breaking changes
  version: "v0.0.1";
  games: {
    [key: GameID]: GameStat;
  };
}

export class LocalPersistantStats {
  private getStats() {
    const statsStr = localStorage.getItem("stats");
    let stats: PersistantStats;
    if (!statsStr) {
      stats = { version: "v0.0.1", games: {} };
    } else {
      stats = JSON.parse(statsStr);
    }

    return stats;
  }

  public startGame(lobby: LobbyConfig) {
    if (typeof localStorage === "undefined") {
      return;
    }

    const stats = this.getStats();
    stats.games[lobby.gameID] = {
      lobby: {
        clientID: lobby.clientID,
        persistentID: lobby.persistentID,
        map: lobby.map,
        gameType: lobby.gameType,
        difficulty: lobby.difficulty,
        infiniteGold: lobby.infiniteGold,
        infiniteTroops: lobby.infiniteTroops,
        instantBuild: lobby.instantBuild,
        bots: lobby.bots,
        disableNPCs: lobby.disableNPCs,
      },
    };
    localStorage.setItem("stats", JSON.stringify(stats));
  }

  public endGame(
    id: GameID,
    playerStats: PlayerStats,
    outcome: GameStat["outcome"],
  ) {
    if (typeof localStorage === "undefined") {
      return;
    }

    const stats = this.getStats();
    const gameStat = stats.games[id];
    if (!gameStat) {
      consolex.log("game not found");
      return;
    }

    gameStat.outcome = outcome;
    gameStat.playerStats = playerStats;
    localStorage.setItem("stats", JSON.stringify(stats));
  }
}
