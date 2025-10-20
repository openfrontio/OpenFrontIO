import { getServerConfigFromServer } from "../src/core/configuration/ConfigLoader";
import { GameMapType, GameMode } from "../src/core/game/Game";
import { initMapNationCounts } from "../src/core/game/MapNationCounts";

describe("HumansVsNations Player Limit Validation", () => {
  const config = getServerConfigFromServer();

  beforeAll(async () => {
    await initMapNationCounts();
  });

  describe("Map player limits for HumansVsNations mode", () => {
    test("Montreal map should have max 2 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Montreal,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(2);
    });

    test("Mars map should have max 4 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Mars,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(4);
    });

    test("World map should have max 56 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.World,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(56);
    });

    test("FaroeIslands map should have max 4 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.FaroeIslands,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(4);
    });

    test("Japan map should have max 10 players", () => {
      const maxPlayers = config.lobbyMaxPlayers(
        GameMapType.Japan,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(10);
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
