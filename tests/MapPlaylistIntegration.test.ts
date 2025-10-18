import { getServerConfigFromServer } from "../src/core/configuration/ConfigLoader";
import { GameMapType, GameMode } from "../src/core/game/Game";
import { initMapNationCounts } from "../src/core/game/MapNationCounts";

describe("MapPlaylist with HumansVsNations", () => {
  beforeAll(async () => {
    await initMapNationCounts();
  });

  test("gameConfig should set maxPlayers to nation count for HumansVsNations mode", () => {
    // We can't directly test MapPlaylist because it only generates FFA and Team modes
    // However, we can verify the logic would work by testing the lobbyMaxPlayers function
    // which is what MapPlaylist.gameConfig() calls to set maxPlayers

    const config = getServerConfigFromServer();

    // Test various maps to ensure nation count is returned for HumansVsNations
    const testCases = [
      { map: GameMapType.World, expectedNations: 61 },
      { map: GameMapType.Europe, expectedNations: 49 },
      { map: GameMapType.Mars, expectedNations: 6 },
      { map: GameMapType.GiantWorldMap, expectedNations: 97 },
      { map: GameMapType.Montreal, expectedNations: 3 },
    ];

    testCases.forEach(({ map, expectedNations }) => {
      const maxPlayers = config.lobbyMaxPlayers(
        map,
        GameMode.HumansVsNations,
        undefined,
      );
      expect(maxPlayers).toBe(expectedNations);
    });
  });

  test("FFA mode should still use random player count config", () => {
    const config = getServerConfigFromServer();

    // For FFA, maxPlayers should be based on numPlayersConfig, not nation count
    const maxPlayers = config.lobbyMaxPlayers(
      GameMapType.World,
      GameMode.FFA,
      undefined,
    );

    // World has [50, 30, 20] in numPlayersConfig
    expect([20, 30, 50]).toContain(maxPlayers);

    // Should NOT be 61 (the nation count for World)
    expect(maxPlayers).not.toBe(61);
  });
});
