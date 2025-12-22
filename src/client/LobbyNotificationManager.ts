import { GameConfig, GameInfo } from "../core/Schemas";
import { GameMode } from "../core/game/Game";

interface NotificationSettings {
  ffaEnabled: boolean;
  teamEnabled: boolean;
  soundEnabled: boolean;
  minTeamCount: number;
  maxTeamCount: number;
}

export class LobbyNotificationManager {
  private settings: NotificationSettings | null = null;
  private audioContext: AudioContext | null = null;
  private seenLobbies: Set<string> = new Set();

  constructor() {
    this.loadSettings();
    this.setupEventListeners();
  }

  private setupEventListeners() {
    window.addEventListener(
      "notification-settings-changed",
      this.handleSettingsChanged,
    );
    window.addEventListener("lobbies-updated", this.handleLobbiesUpdated);
  }

  private handleSettingsChanged = (e: Event) => {
    const event = e as CustomEvent<NotificationSettings>;
    this.settings = event.detail;
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

  private handleLobbiesUpdated = (e: Event) => {
    const event = e as CustomEvent<GameInfo[]>;
    const lobbies = event.detail || [];

    // Check for new lobbies
    lobbies.forEach((lobby) => {
      if (!this.seenLobbies.has(lobby.gameID) && lobby.gameConfig) {
        this.seenLobbies.add(lobby.gameID);

        // Check if this lobby matches user preferences
        if (this.matchesPreferences(lobby.gameConfig)) {
          this.playNotificationSound();
        }
      }
    });

    // Clean up old lobbies no longer in the list
    const currentIds = new Set(lobbies.map((l) => l.gameID));
    for (const id of this.seenLobbies) {
      if (!currentIds.has(id)) {
        this.seenLobbies.delete(id);
      }
    }
  };

  private matchesPreferences(config: GameConfig): boolean {
    if (!this.settings) return false;

    // Check FFA
    if (this.settings.ffaEnabled && config.gameMode === GameMode.FFA) {
      return true;
    }

    // Check Team
    if (this.settings.teamEnabled && config.gameMode === GameMode.Team) {
      const maxPlayers = config.maxPlayers ?? 0;
      const playerTeams = config.playerTeams;

      if (maxPlayers === 0) return false;

      // Map fixed modes to players per team
      const playersPerTeamMap: Record<string, number> = {
        Duos: 2,
        Trios: 3,
        Quads: 4,
        "Humans Vs Nations": 1,
      };

      // Calculate players per team
      // If playerTeams is a string (Duos/Trios/Quads), use the map
      // If it's a number, it's the number of teams, so calculate players per team
      const playersPerTeam =
        typeof playerTeams === "string"
          ? (playersPerTeamMap[playerTeams] ?? 0)
          : typeof playerTeams === "number"
            ? Math.floor(maxPlayers / playerTeams)
            : 0;

      if (playersPerTeam === 0) return false;

      if (playersPerTeam < this.settings.minTeamCount) return false;
      if (playersPerTeam > this.settings.maxTeamCount) return false;

      return true;
    }

    return false;
  }

  private playNotificationSound() {
    if (!this.settings?.soundEnabled) {
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

  public destroy() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    window.removeEventListener(
      "notification-settings-changed",
      this.handleSettingsChanged,
    );
    window.removeEventListener("lobbies-updated", this.handleLobbiesUpdated);
  }
}
