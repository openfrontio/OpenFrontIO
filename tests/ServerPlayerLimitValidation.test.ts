import { getServerConfigFromServer } from "../src/core/configuration/ConfigLoader";
import { GameMapType, GameMode } from "../src/core/game/Game";
import { initMapNationCounts } from "../src/core/game/MapNationCounts";

describe("Server-side HumansVsNations Player Limit Configuration", () => {
  const config = getServerConfigFromServer();

  beforeAll(async () => {
    await initMapNationCounts();
  });

  test("lobbyMaxPlayers should return correct values for HumansVsNations mode", () => {
    const testCases = [
      { map: GameMapType.Montreal, expected: 2 },
      { map: GameMapType.Mars, expected: 4 },
      { map: GameMapType.FaroeIslands, expected: 4 },
      { map: GameMapType.Japan, expected: 10 },
      { map: GameMapType.World, expected: 56 },
      { map: GameMapType.Europe, expected: 45 },
    ];

    testCases.forEach(({ map, expected }) => {
      const maxPlayers = config.lobbyMaxPlayers(
        map,
        GameMode.HumansVsNations,
        undefined,
      );

      expect(maxPlayers).toBe(expected);
    });
  });

  test("lobbyMaxPlayers should be consistent with nation counts", () => {
    const maps = Object.values(GameMapType);

    maps.forEach((map) => {
      const maxPlayers = config.lobbyMaxPlayers(
        map,
        GameMode.HumansVsNations,
        undefined,
      );

      // Max players should be a positive number
      expect(maxPlayers).toBeGreaterThan(0);
      expect(typeof maxPlayers).toBe("number");
    });
  });

  test("lobbyMaxPlayers should differ between maps for HumansVsNations mode", () => {
    const montrealMax = config.lobbyMaxPlayers(
      GameMapType.Montreal,
      GameMode.HumansVsNations,
      undefined,
    );
    const worldMax = config.lobbyMaxPlayers(
      GameMapType.World,
      GameMode.HumansVsNations,
      undefined,
    );

    // Montreal has 3 nations (2 humans), World has 61 nations (56 humans)
    expect(montrealMax).toBeLessThan(worldMax);
    expect(montrealMax).toBe(2);
    expect(worldMax).toBe(56);
  });
});
