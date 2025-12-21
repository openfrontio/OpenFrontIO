import { GameConfig, ServerLobbyNotificationMessage } from "../core/Schemas";
import { GameMode } from "../core/game/Game";
import { translateText } from "./Utils";

interface NotificationSettings {
  ffaEnabled: boolean;
  teamEnabled: boolean;
  soundEnabled: boolean;
  ffaMinPlayers: number;
  ffaMaxPlayers: number;
  teamMinPlayers: number;
  teamMaxPlayers: number;
  selectedTeamCounts: Array<string | number>;
}

export class LobbyNotificationManager {
  private ws: WebSocket | null = null;
  private settings: NotificationSettings | null = null;
  private lastNotificationElement: HTMLElement | null = null;
  private notificationTimeout: number | null = null;
  private isOnLobbyPage = false;
  private reconnectTimer: number | null = null;
  private audioContext: AudioContext | null = null;
  private handlePopState = () => this.checkIfOnLobbyPage();
  private handleGameEnded = () => {
    setTimeout(() => this.checkIfOnLobbyPage(), 100);
  };

  private resolveWebSocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    if (
      window.location.hostname === "localhost" &&
      window.location.port === "9000"
    ) {
      return `${protocol}//localhost:3001/w0`;
    }

    const envUrl = process.env.WEBSOCKET_URL?.trim();
    if (envUrl) {
      if (envUrl.startsWith("ws://") || envUrl.startsWith("wss://")) {
        return envUrl;
      }
      if (envUrl.startsWith("//")) {
        return `${protocol}${envUrl}`;
      }
      return `${protocol}//${envUrl}`;
    }

    // In production, connect to worker subdomain for WebSocket
    if (window.location.hostname !== "localhost") {
      const hostname = window.location.hostname;
      // Extract base domain and add w0- prefix
      const workerHost = `w0-${hostname}`;
      return `${protocol}//${workerHost}/w0`;
    }

    return `${protocol}//${window.location.host}`;
  }

  constructor() {
    this.loadSettings();
    this.setupEventListeners();
    this.connectWebSocket();
  }

  private setupEventListeners() {
    window.addEventListener(
      "notification-settings-changed",
      this.handleSettingsChanged,
    );

    // Monitor URL changes to detect when user is on lobby page
    this.checkIfOnLobbyPage();
    window.addEventListener("popstate", this.handlePopState);

    // Also monitor for custom navigation events if they exist
    window.addEventListener("game-ended", this.handleGameEnded);
  }

  private checkIfOnLobbyPage() {
    const wasOnLobbyPage = this.isOnLobbyPage;

    // Check if we're on the main lobby page
    const path = window.location.pathname;
    const hash = window.location.hash;
    this.isOnLobbyPage =
      (path === "/" || path === "") &&
      (hash === "" || hash === "#/" || hash === "#");

    // Register or unregister with server when page status changes
    if (this.isOnLobbyPage && !wasOnLobbyPage) {
      this.registerPreferences();
    } else if (!this.isOnLobbyPage && wasOnLobbyPage) {
      this.unregisterPreferences();
    }
  }

  private handleSettingsChanged = (e: Event) => {
    const event = e as CustomEvent<NotificationSettings>;
    this.settings = event.detail;

    // Re-register with server if we're on the lobby page
    if (this.isOnLobbyPage) {
      this.registerPreferences();
    }
  };

  private loadSettings() {
    try {
      const saved = localStorage.getItem("lobbyNotificationSettings");
      if (saved) {
        this.settings = JSON.parse(saved);
      }
    } catch (error) {
      console.error("Failed to load notification settings:", error);
    }
  }

  private connectWebSocket() {
    try {
      const wsUrl = this.resolveWebSocketUrl();
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`Notification WebSocket connected to: ${wsUrl}`);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        // Register if we're on lobby page and have settings
        if (this.isOnLobbyPage && this.settings) {
          this.registerPreferences();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "lobby_notification") {
            this.handleLobbyNotification(
              message as ServerLobbyNotificationMessage,
            );
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      this.ws.onclose = (event) => {
        console.log(
          `Notification WebSocket disconnected (code: ${event.code}, reason: ${event.reason || "no reason provided"}), reconnecting in 5s...`,
        );
        this.ws = null;
        // Reconnect after 5 seconds
        this.reconnectTimer = window.setTimeout(() => {
          this.connectWebSocket();
        }, 5000);
      };

      this.ws.onerror = (error) => {
        const wsState =
          this.ws?.readyState === WebSocket.CONNECTING
            ? "CONNECTING"
            : this.ws?.readyState === WebSocket.OPEN
              ? "OPEN"
              : this.ws?.readyState === WebSocket.CLOSING
                ? "CLOSING"
                : this.ws?.readyState === WebSocket.CLOSED
                  ? "CLOSED"
                  : "UNKNOWN";
        console.error(
          `WebSocket error (state: ${wsState}):`,
          error instanceof Event ? `Event type: ${error.type}` : String(error),
        );
        console.warn(
          `Failed to connect to notification WebSocket at: ${wsUrl}`,
        );
      };
    } catch (error) {
      console.error(
        "Failed to create WebSocket connection:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private registerPreferences() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.settings) {
      return;
    }

    // Only register if notifications are enabled
    if (!this.settings.ffaEnabled && !this.settings.teamEnabled) {
      return;
    }

    const message = {
      type: "register_notifications",
      preferences: {
        ffaEnabled: this.settings.ffaEnabled,
        teamEnabled: this.settings.teamEnabled,
        ffaMinPlayers: this.settings.ffaMinPlayers,
        ffaMaxPlayers: this.settings.ffaMaxPlayers,
        teamMinPlayers: this.settings.teamMinPlayers,
        teamMaxPlayers: this.settings.teamMaxPlayers,
        selectedTeamCounts: this.settings.selectedTeamCounts,
      },
    };

    try {
      this.ws.send(JSON.stringify(message));
      console.log("Registered notification preferences with server");
    } catch (error) {
      console.error("Failed to register preferences:", error);
    }
  }

  private unregisterPreferences() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: "register_notifications",
      preferences: null,
    };

    try {
      this.ws.send(JSON.stringify(message));
      console.log("Unregistered notification preferences from server");
    } catch (error) {
      console.error("Failed to unregister preferences:", error);
    }
  }

  private handleLobbyNotification(message: ServerLobbyNotificationMessage) {
    if (!this.isOnLobbyPage) return;

    const { gameConfig } = message.gameInfo;
    if (!gameConfig) return;

    // Show notification
    this.showNotification(gameConfig);
    this.playNotificationSound();
  }

  private playNotificationSound() {
    if (!this.settings?.soundEnabled || !this.isOnLobbyPage) {
      return;
    }

    this.playBeepSound();
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext) {
      return this.audioContext;
    }

    try {
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      return this.audioContext;
    } catch (error) {
      console.error("Failed to create AudioContext:", error);
      return null;
    }
  }

  private playBeepSound() {
    try {
      const audioContext = this.getAudioContext();
      if (!audioContext) return;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.3,
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.error("Failed to play beep sound:", error);
    }
  }

  private showNotification(gameConfig: GameConfig) {
    // Dismiss any existing notification
    this.dismissNotification();

    const notification = document.createElement("div");
    notification.className = "lobby-notification";
    notification.textContent = this.getGameDetailsText(gameConfig);

    // Click to dismiss
    notification.addEventListener("click", () => this.dismissNotification());

    document.body.appendChild(notification);
    this.lastNotificationElement = notification;

    // Trigger animation
    setTimeout(() => {
      notification.classList.add("notification-visible");
    }, 10);

    // Auto-dismiss after 10 seconds
    this.notificationTimeout = window.setTimeout(() => {
      this.dismissNotification();
    }, 10000);
  }

  private dismissNotification() {
    if (this.lastNotificationElement) {
      const element = this.lastNotificationElement;
      element.classList.add("notification-dismissing");
      element.classList.remove("notification-visible");

      setTimeout(() => {
        if (element.parentNode) {
          element.parentNode.removeChild(element);
        }
        if (this.lastNotificationElement === element) {
          this.lastNotificationElement = null;
        }
      }, 300);
    }

    if (this.notificationTimeout !== null) {
      clearTimeout(this.notificationTimeout);
      this.notificationTimeout = null;
    }
  }

  private getGameDetailsText(gameConfig: GameConfig): string {
    const gameCapacity = gameConfig.maxPlayers ?? null;

    if (gameConfig.gameMode === GameMode.FFA) {
      return translateText("notification.ffa_game_found");
    } else if (gameConfig.gameMode === GameMode.Team) {
      const playerTeams = gameConfig.playerTeams;

      if (playerTeams === "Duos") {
        return translateText("notification.duos_game_found");
      } else if (playerTeams === "Trios") {
        return translateText("notification.trios_game_found");
      } else if (playerTeams === "Quads") {
        return translateText("notification.quads_game_found");
      } else if (typeof playerTeams === "number" && gameCapacity !== null) {
        return translateText("notification.teams_game_found", {
          teams: playerTeams,
        });
      }
    }

    return translateText("notification.game_found");
  }

  public destroy() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    window.removeEventListener(
      "notification-settings-changed",
      this.handleSettingsChanged,
    );
    window.removeEventListener("popstate", this.handlePopState);
    window.removeEventListener("game-ended", this.handleGameEnded);
    this.dismissNotification();
  }
}
