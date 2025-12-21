import { WebSocket } from "ws";
import { GameMode } from "../core/game/Game";
import { GameConfig, ServerLobbyNotificationMessage } from "../core/Schemas";
import { replacer } from "../core/Util";

interface NotificationPreferences {
  ffaEnabled: boolean;
  teamEnabled: boolean;
  ffaMinPlayers?: number;
  ffaMaxPlayers?: number;
  teamMinPlayers?: number;
  teamMaxPlayers?: number;
  selectedTeamCounts?: Array<string | number>;
}

interface RegisteredClient {
  ws: WebSocket;
  preferences: NotificationPreferences;
}

export class NotificationBroadcaster {
  private registeredClients: Map<WebSocket, NotificationPreferences> =
    new Map();

  registerClient(ws: WebSocket, preferences: NotificationPreferences | null) {
    if (preferences === null) {
      // Unregister
      this.registeredClients.delete(ws);
    } else {
      // Register or update preferences
      this.registeredClients.set(ws, preferences);
    }
  }

  unregisterClient(ws: WebSocket) {
    this.registeredClients.delete(ws);
  }

  broadcastGameCreated(gameID: string, gameConfig: GameConfig) {
    // Only broadcast for public games
    if (gameConfig.gameType !== "Public") {
      return;
    }

    const gameCapacity = gameConfig.maxPlayers ?? null;
    if (gameCapacity === null) return;

    const message: ServerLobbyNotificationMessage = {
      type: "lobby_notification",
      gameInfo: {
        gameID,
        gameConfig,
      },
    };

    const messageStr = JSON.stringify(message, replacer);

    // Broadcast to all matching clients
    for (const [ws, prefs] of this.registeredClients.entries()) {
      if (ws.readyState === WebSocket.OPEN && this.matchesPreferences(gameConfig, gameCapacity, prefs)) {
        try {
          ws.send(messageStr);
        } catch (error) {
          console.error("Failed to send notification to client:", error);
        }
      }
    }
  }

  private matchesPreferences(
    config: GameConfig,
    gameCapacity: number,
    prefs: NotificationPreferences
  ): boolean {
    // Check FFA
    if (prefs.ffaEnabled && config.gameMode === GameMode.FFA) {
      if (
        prefs.ffaMinPlayers !== undefined &&
        gameCapacity < prefs.ffaMinPlayers
      )
        return false;
      if (
        prefs.ffaMaxPlayers !== undefined &&
        gameCapacity > prefs.ffaMaxPlayers
      )
        return false;
      return true;
    }

    // Check Team
    if (prefs.teamEnabled && config.gameMode === GameMode.Team) {
      if (
        prefs.teamMinPlayers !== undefined &&
        gameCapacity < prefs.teamMinPlayers
      )
        return false;
      if (
        prefs.teamMaxPlayers !== undefined &&
        gameCapacity > prefs.teamMaxPlayers
      )
        return false;

      // Check team configuration
      if (prefs.selectedTeamCounts && prefs.selectedTeamCounts.length > 0) {
        const playerTeams = config.playerTeams;
        const matchesTeamCount = prefs.selectedTeamCounts.some(
          (selectedCount) => {
            return playerTeams === selectedCount;
          }
        );
        if (!matchesTeamCount) return false;
      }

      return true;
    }

    return false;
  }

  // Clean up closed connections periodically
  cleanup() {
    for (const [ws] of this.registeredClients.entries()) {
      if (ws.readyState !== WebSocket.OPEN) {
        this.registeredClients.delete(ws);
      }
    }
  }
}
