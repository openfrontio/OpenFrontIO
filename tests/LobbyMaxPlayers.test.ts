import { getServerConfigFromServer } from "../src/core/configuration/ConfigLoader";
import { GameMapType, GameMode } from "../src/core/game/Game";
import { initMapNationCounts } from "../src/core/game/MapNationCounts";

describe("LobbyMaxPlayers", () => {
  const config = getServerConfigFromServer();

  beforeAll(async () => {
    await initMapNationCounts();
  });

  describe("HumansVsNations mode", () => {
    test("should return nation count for World map", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.World,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(61);
    });

    test("should return nation count for Europe map", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Europe,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(49);
    });

    test("should return nation count for Mars map", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Mars,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(6);
    });

    test("should return nation count for Montreal map", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Montreal,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(3);
    });

    test("should return nation count for GiantWorldMap", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.GiantWorldMap,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(97);
    });
  });

  describe("FFA mode", () => {
    test("should return a value based on numPlayersConfig", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.World,
        GameMode.FFA,
        undefined,
      );
      // Should be one of: 50, 30, or 20 (from numPlayersConfig for World)
      expect([20, 30, 50]).toContain(maxPlayers);
    });
  });

  describe("Team mode", () => {
    test("should return a value based on numPlayersConfig with team adjustment", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.World,
        GameMode.Team,
        2,
      );
      // Should be even (divisible by 2) and based on World's config
      expect(maxPlayers % 2).toBe(0);
      expect(maxPlayers).toBeGreaterThan(0);
    });
  });
});
