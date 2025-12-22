/**
 * @jest-environment jsdom
 */
import { LobbyNotificationManager } from "../../src/client/LobbyNotificationManager";
import { GameConfig, GameInfo } from "../../src/core/Schemas";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";

describe("LobbyNotificationManager", () => {
  let manager: LobbyNotificationManager;
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {};
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => localStorageMock[key] || null,
        setItem: (key: string, value: string) => {
          localStorageMock[key] = value;
        },
        removeItem: (key: string) => {
          delete localStorageMock[key];
        },
        clear: () => {
          localStorageMock = {};
        },
      },
      writable: true,
    });

    // Mock AudioContext
    const mockAudioContext = {
      createOscillator: jest.fn().mockReturnValue({
        connect: jest.fn().mockReturnThis(),
        frequency: { value: 0 },
        type: "sine",
        start: jest.fn(),
        stop: jest.fn(),
      }),
      createGain: jest.fn().mockReturnValue({
        connect: jest.fn().mockReturnThis(),
        gain: {
          setValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
      }),
      destination: {},
      currentTime: 0,
      close: jest.fn(),
    };

    (window as any).AudioContext = jest.fn().mockReturnValue(mockAudioContext);
    (window as any).webkitAudioContext = jest
      .fn()
      .mockReturnValue(mockAudioContext);

    jest.clearAllMocks();
    manager = new LobbyNotificationManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("Constructor and Initialization", () => {
    test("should initialize with no settings if localStorage is empty", () => {
      const newManager = new LobbyNotificationManager();
      expect(newManager).toBeDefined();
      newManager.destroy();
    });

    test("should load settings from localStorage on initialization", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );

      const newManager = new LobbyNotificationManager();
      expect(newManager).toBeDefined();
      newManager.destroy();
    });

    test("should handle corrupted localStorage data gracefully", () => {
      localStorage.setItem("lobbyNotificationSettings", "invalid json");

      const newManager = new LobbyNotificationManager();
      expect(newManager).toBeDefined();

      newManager.destroy();
    });
  });

  describe("Settings Persistence", () => {
    test("should update settings when notification-settings-changed event is dispatched", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: true,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };

      const event = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });

      window.dispatchEvent(event);

      // Verify settings were applied by testing behavior
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const lobbyEvent = new CustomEvent("lobbies-updated", {
        detail: [{ gameID: "test-lobby", gameConfig, numClients: 5 }],
      });

      jest.clearAllMocks();
      window.dispatchEvent(lobbyEvent);

      // Should trigger notification since FFA is enabled in settings
      expect((window as any).AudioContext).toHaveBeenCalled();
    });

    test("should persist settings to localStorage", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };

      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      const stored = localStorage.getItem("lobbyNotificationSettings");
      const parsed = JSON.parse(stored ?? "{}");

      expect(parsed.minTeamCount).toBe(2);
      expect(parsed.ffaEnabled).toBe(true);
    });
  });

  describe("FFA Lobby Matching Logic", () => {
    beforeEach(() => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager = new LobbyNotificationManager();
    });

    test("should match any FFA lobby when enabled", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-1",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect((window as any).AudioContext).toHaveBeenCalled();
    });

    test("should not match when FFA is disabled", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      jest.clearAllMocks();
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-2",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect((window as any).AudioContext).not.toHaveBeenCalled();
    });
  });

  describe("Team Lobby Matching Logic - Players Per Team", () => {
    beforeEach(() => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: true,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager = new LobbyNotificationManager();
    });

    test("should match Duos (2 players per team)", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: true,
        donateTroops: true,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 100,
        playerTeams: "Duos",
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-duos",
        gameConfig,
        numClients: 50,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      expect(
        (window as any).AudioContext.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
      const audioContextInstance = (window as any).AudioContext.mock.results[0]
        .value;
      expect(audioContextInstance.createOscillator).toHaveBeenCalled();
    });

    test("should match Trios (3 players per team)", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: true,
        donateTroops: true,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 90,
        playerTeams: "Trios",
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-trios",
        gameConfig,
        numClients: 30,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      expect(
        (window as any).AudioContext.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
      const audioContextInstance = (window as any).AudioContext.mock.results[0]
        .value;
      expect(audioContextInstance.createOscillator).toHaveBeenCalled();
    });

    test("should match Quads (4 players per team)", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: true,
        donateTroops: true,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 100,
        playerTeams: "Quads",
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-quads",
        gameConfig,
        numClients: 25,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      expect(
        (window as any).AudioContext.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
      const audioContextInstance = (window as any).AudioContext.mock.results[0]
        .value;
      expect(audioContextInstance.createOscillator).toHaveBeenCalled();
    });

    test("should not match teams with players per team below min (50 players, 25 teams = 2 per team)", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: true,
        soundEnabled: true,
        minTeamCount: 3,
        maxTeamCount: 10,
      };
      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: true,
        donateTroops: true,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 50,
        playerTeams: 25, // 50/25 = 2 players per team
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-too-small",
        gameConfig,
        numClients: 50,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      // Should NOT have triggered notification
      expect((window as any).AudioContext).not.toHaveBeenCalled();
    });

    test("should not match teams with players per team above max (50 players, 2 teams = 25 per team)", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: true,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 10,
      };
      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: true,
        donateTroops: true,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 50,
        playerTeams: 2, // 50/2 = 25 players per team
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-too-big",
        gameConfig,
        numClients: 50,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      // Should NOT have triggered notification
      expect((window as any).AudioContext).not.toHaveBeenCalled();
    });

    test("should match teams with calculated players per team (100 players, 25 teams = 4 per team)", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: true,
        donateTroops: true,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 100,
        playerTeams: 25, // 100/25 = 4 players per team
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-calculated",
        gameConfig,
        numClients: 100,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      expect(
        (window as any).AudioContext.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
      const audioContextInstance = (window as any).AudioContext.mock.results[0]
        .value;
      expect(audioContextInstance.createOscillator).toHaveBeenCalled();
    });

    test("should not match when Team is disabled", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: true,
        donateTroops: true,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 20,
        playerTeams: "Duos",
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-disabled",
        gameConfig,
        numClients: 10,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      // Should NOT have triggered notification when Team mode is disabled
      expect((window as any).AudioContext).not.toHaveBeenCalled();
    });
  });

  describe("Sound Notification Triggering", () => {
    test("should play sound when sound is enabled and lobby matches", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-sound",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect((window as any).AudioContext).toHaveBeenCalled();
    });

    test("should not play sound when sound is disabled", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: false,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-nosound",
        gameConfig,
        numClients: 5,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect((window as any).AudioContext).not.toHaveBeenCalled();
    });

    test("should handle AudioContext creation failure gracefully", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();

      (window as any).AudioContext = jest.fn().mockImplementation(() => {
        throw new Error("AudioContext not supported");
      });

      manager = new LobbyNotificationManager();

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-error",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      expect(() => window.dispatchEvent(event)).not.toThrow();
    });
  });

  describe("Single Notification Per Lobby", () => {
    beforeEach(() => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager = new LobbyNotificationManager();
    });

    test("should only trigger notification once for the same lobby", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-duplicate",
        gameConfig,
        numClients: 5,
      };

      jest.clearAllMocks();
      const event1 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event1);

      const callCount1 = (window as any).AudioContext.mock.calls.length;

      const event2 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event2);

      const callCount2 = (window as any).AudioContext.mock.calls.length;

      expect(callCount2).toBe(callCount1);
    });

    test("should trigger notification when new lobby is added", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      jest.clearAllMocks();

      // First lobby
      const gameInfo1: GameInfo = {
        gameID: "lobby-new-1",
        gameConfig,
        numClients: 5,
      };
      const event1 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo1],
      });
      window.dispatchEvent(event1);

      // AudioContext created once
      expect((window as any).AudioContext.mock.calls.length).toBe(1);
      const audioContextInstance = (window as any).AudioContext.mock.results[0]
        .value;
      expect(audioContextInstance.createOscillator.mock.calls.length).toBe(1);

      // Add second lobby
      const gameInfo2: GameInfo = {
        gameID: "lobby-new-2",
        gameConfig,
        numClients: 5,
      };

      // Send both lobbies (realistic behavior)
      const event2 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo1, gameInfo2],
      });
      window.dispatchEvent(event2);

      // AudioContext still only created once (reused), but oscillator called twice
      expect((window as any).AudioContext.mock.calls.length).toBe(1);
      expect(audioContextInstance.createOscillator.mock.calls.length).toBe(2);
    });

    test("should clear seen lobbies when they are removed from the list", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-cleared",
        gameConfig,
        numClients: 5,
      };

      jest.clearAllMocks();

      // Add lobby first time
      const event1 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event1);

      expect((window as any).AudioContext.mock.calls.length).toBe(1);
      const audioContextInstance = (window as any).AudioContext.mock.results[0]
        .value;
      expect(audioContextInstance.createOscillator.mock.calls.length).toBe(1);

      // Keep lobby but add a second one
      const gameInfo2: GameInfo = {
        gameID: "lobby-2",
        gameConfig,
        numClients: 5,
      };

      const event2 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo, gameInfo2],
      });
      window.dispatchEvent(event2);

      // AudioContext still only created once, but oscillator called twice (once for each unique lobby)
      expect((window as any).AudioContext.mock.calls.length).toBe(1);
      expect(audioContextInstance.createOscillator.mock.calls.length).toBe(2);

      // Remove both lobbies
      const event3 = new CustomEvent("lobbies-updated", {
        detail: [],
      });
      window.dispatchEvent(event3);

      // Re-add first lobby - should trigger notification again since it was cleared
      const event4 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event4);

      // Oscillator called 3 times total
      expect(audioContextInstance.createOscillator.mock.calls.length).toBe(3);
    });
  });

  describe("Cleanup and Destruction", () => {
    test("should remove event listeners on destroy", () => {
      const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
      manager.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "lobbies-updated",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "notification-settings-changed",
        expect.any(Function),
      );

      removeEventListenerSpy.mockRestore();
    });

    test("should close AudioContext on destroy", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager = new LobbyNotificationManager();

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-cleanup",
        gameConfig,
        numClients: 5,
      };

      jest.clearAllMocks();
      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event);

      // Verify notification was triggered and get AudioContext instance
      expect((window as any).AudioContext.mock.calls.length).toBe(1);
      const audioContextInstance = (window as any).AudioContext.mock.results[0]
        .value;

      manager.destroy();

      // Verify close() was called on the AudioContext
      expect(audioContextInstance.close).toHaveBeenCalled();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    beforeEach(() => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: true,
        soundEnabled: true,
        minTeamCount: 2,
        maxTeamCount: 4,
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager = new LobbyNotificationManager();
    });

    test("should handle lobbies-updated event with undefined gameConfig", () => {
      const gameInfo: GameInfo = {
        gameID: "lobby-no-config",
        gameConfig: undefined as any,
        numClients: 0,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      expect(() => window.dispatchEvent(event)).not.toThrow();
    });

    test("should handle lobbies-updated event with undefined detail", () => {
      const event = new CustomEvent("lobbies-updated", {
        detail: undefined,
      });

      expect(() => window.dispatchEvent(event)).not.toThrow();
    });

    test("should handle lobbies-updated event with null detail", () => {
      const event = new CustomEvent("lobbies-updated", {
        detail: null,
      });

      expect(() => window.dispatchEvent(event)).not.toThrow();
    });

    test("should handle missing settings gracefully", () => {
      manager.destroy();
      localStorage.clear();
      manager = new LobbyNotificationManager();

      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        maxPlayers: 10,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-no-settings",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      expect(() => window.dispatchEvent(event)).not.toThrow();
    });

    test("should handle GameConfig with missing optional maxPlayers", () => {
      const gameConfig: GameConfig = {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        donateGold: false,
        donateTroops: false,
        gameType: GameType.Private,
        gameMode: GameMode.Team,
        gameMapSize: GameMapSize.Compact,
        disableNations: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
        playerTeams: "Duos",
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-no-maxplayers",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      expect(() => window.dispatchEvent(event)).not.toThrow();
    });
  });
});
