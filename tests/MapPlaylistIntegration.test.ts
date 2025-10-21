import { getServerConfigFromServer } from "../src/core/configuration/ConfigLoader";
import { GameMapType, GameMode, HumansVsNations } from "../src/core/game/Game";

describe("MapPlaylist with HumansVsNations", () => {
  test("gameConfig should use normal player count for HumansVsNations team config", () => {
    // HumansVsNations no longer uses the linear regression formula
    // It now uses the standard player count like Team mode
    const config = getServerConfigFromServer();

    // Test that HumansVsNations returns a valid player count from the map config
    const testCases = [
      { map: GameMapType.World },
      { map: GameMapType.Europe },
      { map: GameMapType.Mars },
      { map: GameMapType.GiantWorldMap },
      { map: GameMapType.Montreal },
    ];

    testCases.forEach(({ map }) => {
      const maxPlayers = config.lobbyMaxPlayers(
        map,
        GameMode.Team,
        HumansVsNations,
      );
      // Should return a valid number from the numPlayersConfig
      expect(maxPlayers).toBeGreaterThan(0);
      expect(maxPlayers).toBeLessThanOrEqual(150);
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
