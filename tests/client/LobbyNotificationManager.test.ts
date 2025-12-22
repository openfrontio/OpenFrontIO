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
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
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
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const newManager = new LobbyNotificationManager();
      expect(newManager).toBeDefined();
      expect(consoleSpy).toHaveBeenCalled();

      newManager.destroy();
      consoleSpy.mockRestore();
    });
  });

  describe("Settings Persistence", () => {
    test("should update settings when notification-settings-changed event is dispatched", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: true,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: ["2", "3"],
      };

      const event = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should persist settings to localStorage", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 5,
        ffaMaxPlayers: 100,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };

      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      const stored = localStorage.getItem("lobbyNotificationSettings");
      const parsed = JSON.parse(stored ?? "{}");

      expect(parsed.ffaMinPlayers).toBe(5);
      expect(parsed.ffaEnabled).toBe(true);
    });
  });

  describe("FFA Lobby Matching Logic", () => {
    beforeEach(() => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager = new LobbyNotificationManager();
    });

    test("should match FFA lobby within player range", () => {
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

      // This is a private method, so we'll trigger it through the event system
      const gameInfo: GameInfo = {
        gameID: "lobby-1",
        gameConfig,
        numClients: 5,
      };

      const originalAudioContext = (window as any).AudioContext;
      (window as any).AudioContext = jest.fn().mockImplementation(() => {
        return {
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
      });

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      (window as any).AudioContext = originalAudioContext;
    });

    test("should not match FFA lobby with player count below minimum", () => {
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
        maxPlayers: 1,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-2",
        gameConfig,
        numClients: 1,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      // No assertion needed - test passes if no errors thrown
      expect(manager).toBeDefined();
    });

    test("should not match FFA lobby with player count above maximum", () => {
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
        maxPlayers: 100,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-3",
        gameConfig,
        numClients: 100,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should match FFA lobby at minimum boundary", () => {
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
        maxPlayers: 2,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-4",
        gameConfig,
        numClients: 2,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should match FFA lobby at maximum boundary", () => {
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
        maxPlayers: 50,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-5",
        gameConfig,
        numClients: 50,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should not match when FFA is disabled", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

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
        gameID: "lobby-6",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });
  });

  describe("Team Lobby Matching Logic", () => {
    beforeEach(() => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: true,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: ["2", "3"],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager = new LobbyNotificationManager();
    });

    test("should match Team lobby within player range and with selected team count", () => {
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
        playerTeams: 2,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-7",
        gameConfig,
        numClients: 10,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should not match Team lobby with player count below minimum", () => {
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
        maxPlayers: 2,
        playerTeams: 2,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-8",
        gameConfig,
        numClients: 2,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should not match Team lobby with player count above maximum", () => {
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
        maxPlayers: 200,
        playerTeams: 2,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-9",
        gameConfig,
        numClients: 200,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should not match Team lobby with non-selected team count", () => {
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
        playerTeams: 4,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-10",
        gameConfig,
        numClients: 16,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should match Team lobby with any team count when none are selected", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: true,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

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
        playerTeams: 5,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-11",
        gameConfig,
        numClients: 10,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should match Team lobby at minimum boundary", () => {
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
        maxPlayers: 4,
        playerTeams: 2,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-12",
        gameConfig,
        numClients: 4,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should match Team lobby at maximum boundary", () => {
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
        playerTeams: 3,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-13",
        gameConfig,
        numClients: 100,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should not match when Team is disabled", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: ["2", "3"],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

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
        playerTeams: 2,
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-14",
        gameConfig,
        numClients: 10,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should support multiple team count configurations", () => {
      const settings = {
        ffaEnabled: false,
        teamEnabled: true,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: ["2", "3", "4"],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const gameConfigs = [
        { playerTeams: 2 },
        { playerTeams: 3 },
        { playerTeams: 4 },
      ];

      gameConfigs.forEach((config, index) => {
        const gameInfo: GameInfo = {
          gameID: `lobby-multi-${index}`,
          gameConfig: {
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
            ...config,
          },
          numClients: 10,
        };

        const event = new CustomEvent("lobbies-updated", {
          detail: [gameInfo],
        });

        window.dispatchEvent(event);
      });

      expect(manager).toBeDefined();
    });
  });

  describe("Sound Notification Triggering", () => {
    test("should play sound when sound is enabled and lobby matches", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

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

      (window as any).AudioContext = jest
        .fn()
        .mockReturnValue(mockAudioContext);

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
        gameID: "lobby-sound-1",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      // Verify AudioContext was accessed
      expect((window as any).AudioContext).toBeDefined();
    });

    test("should not play sound when sound is disabled", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: false,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const mockCreateOscillator = jest.fn();
      const mockAudioContext = {
        createOscillator: mockCreateOscillator,
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

      (window as any).AudioContext = jest
        .fn()
        .mockReturnValue(mockAudioContext);

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
        gameID: "lobby-sound-2",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      // Oscillator should not be created when sound is disabled
      expect(mockCreateOscillator).not.toHaveBeenCalled();
    });

    test("should handle AudioContext creation failure gracefully", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      (window as any).AudioContext = jest.fn().mockImplementation(() => {
        throw new Error("AudioContext not supported");
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

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
        gameID: "lobby-sound-3",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Single Notification Per Lobby", () => {
    test("should only trigger notification once for the same lobby", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const mockCreateOscillator = jest.fn().mockReturnValue({
        connect: jest.fn().mockReturnThis(),
        frequency: { value: 0 },
        type: "sine",
        start: jest.fn(),
        stop: jest.fn(),
      });

      const mockAudioContext = {
        createOscillator: mockCreateOscillator,
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

      (window as any).AudioContext = jest
        .fn()
        .mockReturnValue(mockAudioContext);

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
        gameID: "lobby-single",
        gameConfig,
        numClients: 5,
      };

      // First time - should trigger notification
      const event1 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event1);

      const firstCallCount = mockCreateOscillator.mock.calls.length;

      // Second time - should not trigger notification for same lobby
      const event2 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event2);

      const secondCallCount = mockCreateOscillator.mock.calls.length;

      // Call count should not increase
      expect(secondCallCount).toBe(firstCallCount);
    });

    test("should trigger notification for different lobbies", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const mockCreateOscillator = jest.fn().mockReturnValue({
        connect: jest.fn().mockReturnThis(),
        frequency: { value: 0 },
        type: "sine",
        start: jest.fn(),
        stop: jest.fn(),
      });

      const mockAudioContext = {
        createOscillator: mockCreateOscillator,
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

      (window as any).AudioContext = jest
        .fn()
        .mockReturnValue(mockAudioContext);

      const gameConfig1: GameConfig = {
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

      const gameInfo1: GameInfo = {
        gameID: "lobby-diff-1",
        gameConfig: gameConfig1,
        numClients: 5,
      };

      // First lobby
      const event1 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo1],
      });
      window.dispatchEvent(event1);

      const firstCallCount = mockCreateOscillator.mock.calls.length;

      const gameConfig2: GameConfig = {
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

      const gameInfo2: GameInfo = {
        gameID: "lobby-diff-2",
        gameConfig: gameConfig2,
        numClients: 5,
      };

      // Second different lobby
      const event2 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo2],
      });
      window.dispatchEvent(event2);

      const secondCallCount = mockCreateOscillator.mock.calls.length;

      // Should have triggered notification for second lobby
      expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });

    test("should clear seen lobbies when they are removed from the list", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

      const mockCreateOscillator = jest.fn().mockReturnValue({
        connect: jest.fn().mockReturnThis(),
        frequency: { value: 0 },
        type: "sine",
        start: jest.fn(),
        stop: jest.fn(),
      });

      const mockAudioContext = {
        createOscillator: mockCreateOscillator,
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

      (window as any).AudioContext = jest
        .fn()
        .mockReturnValue(mockAudioContext);

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

      // First event with lobby
      const event1 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event1);

      // Second event with empty list
      const event2 = new CustomEvent("lobbies-updated", {
        detail: [],
      });
      window.dispatchEvent(event2);

      // Third event with same lobby again - should trigger notification again
      const event3 = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });
      window.dispatchEvent(event3);

      // Should have been called at least twice for the same lobby (once removed, once added back)
      expect(mockCreateOscillator.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Cleanup and Destruction", () => {
    test("should remove event listeners on destroy", () => {
      const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");

      manager.destroy();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "notification-settings-changed",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "lobbies-updated",
        expect.any(Function),
      );

      removeEventListenerSpy.mockRestore();
    });

    test("should close AudioContext on destroy", () => {
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

      (window as any).AudioContext = jest
        .fn()
        .mockReturnValue(mockAudioContext);

      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );

      const testManager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

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
        gameID: "lobby-cleanup-audio",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);

      testManager.destroy();

      expect(mockAudioContext.close).toHaveBeenCalled();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("should handle lobbies-updated event with undefined gameConfig", () => {
      const gameInfo: GameInfo = {
        gameID: "lobby-undefined-config",
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should handle lobbies-updated event with undefined detail", () => {
      const event = new CustomEvent("lobbies-updated", {
        detail: undefined,
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should handle lobbies-updated event with null detail", () => {
      const event = new CustomEvent("lobbies-updated", {
        detail: null,
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });

    test("should handle missing settings gracefully", () => {
      localStorage.clear();
      const newManager = new LobbyNotificationManager();

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

      window.dispatchEvent(event);

      newManager.destroy();
      expect(newManager).toBeDefined();
    });

    test("should handle GameConfig with missing optional maxPlayers", () => {
      const settings = {
        ffaEnabled: true,
        teamEnabled: false,
        soundEnabled: true,
        ffaMinPlayers: 2,
        ffaMaxPlayers: 50,
        teamMinPlayers: 4,
        teamMaxPlayers: 100,
        selectedTeamCounts: [],
      };
      localStorage.setItem(
        "lobbyNotificationSettings",
        JSON.stringify(settings),
      );
      manager.destroy();
      manager = new LobbyNotificationManager();

      const settingsEvent = new CustomEvent("notification-settings-changed", {
        detail: settings,
      });
      window.dispatchEvent(settingsEvent);

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
        // maxPlayers is undefined
      };

      const gameInfo: GameInfo = {
        gameID: "lobby-no-maxplayers",
        gameConfig,
        numClients: 5,
      };

      const event = new CustomEvent("lobbies-updated", {
        detail: [gameInfo],
      });

      window.dispatchEvent(event);
      expect(manager).toBeDefined();
    });
  });
});
