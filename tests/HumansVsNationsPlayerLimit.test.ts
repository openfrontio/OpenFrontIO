import { getServerConfigFromServer } from "../src/core/configuration/ConfigLoader";
import { GameMapType, GameMode } from "../src/core/game/Game";
import { initMapNationCounts } from "../src/core/game/MapNationCounts";

describe("HumansVsNations Player Limit Validation", () => {
  const config = getServerConfigFromServer();

  beforeAll(async () => {
    await initMapNationCounts();
  });

  describe("Map player limits for HumansVsNations mode", () => {
    test("Montreal map should have max 3 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Montreal,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(3);
    });

    test("Mars map should have max 6 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Mars,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(6);
    });

    test("World map should have max 61 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.World,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(61);
    });

    test("FaroeIslands map should have max 6 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.FaroeIslands,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(6);
    });

    test("Japan map should have max 12 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Japan,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(12);
    });
  });

  describe("Player limit should match nation count", () => {
    test("All maps should have maxPlayers equal to nation count in HumansVsNations mode", () => {
      const maps = Object.values(GameMapType);
      maps.forEach((map) => {
        const maxPlayers = config.lobbyMaxPlayers(
          map,
          GameMode.HumansVsNations,
          undefined,
        );
        expect(maxPlayers).toBeGreaterThan(0);
        expect(typeof maxPlayers).toBe("number");
      });
    });
  });
});
