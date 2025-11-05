import { PlayerSpawner } from "../../../../src/core/execution/utils/PlayerSpawner";
import { PlayerInfo, PlayerType } from "../../../../src/core/game/Game";
import { setup } from "../../../util/Setup";

describe("PlayerSpawner", () => {
  // Manually calculated based on number of tiles in manifest of each map
  // and minimum distance between players in PlayerSpawner
  test.each([
    ["big_plains", 49],
    ["half_land_half_ocean", 1],
    ["ocean_and_land", 1],
    ["plains", 9],
  ])(
    "Spawn location is found for all players in %s map with %i players",
    async (mapName, maxPlayers) => {
      const players: PlayerInfo[] = [];

      for (let i = 0; i < maxPlayers; i++) {
        players.push(
          new PlayerInfo(
            `player${i}`,
            PlayerType.Human,
            `client_id${i}`,
            `player_id${i}`,
          ),
        );
      }

      const game = await setup(mapName, undefined, players);

      const executors = new PlayerSpawner(game, "game_id").spawnPlayers();
      expect(executors.length).toBe(maxPlayers);

      for (const executor of executors) {
        expect(game.isLand(executor.tile)).toBe(true);
        expect(game.isBorder(executor.tile)).toBe(false);
      }

      for (let i = 0; i < executors.length; i++) {
        for (let j = i + 1; j < executors.length; j++) {
          const distance = game.manhattanDist(
            executors[i].tile,
            executors[j].tile,
          );
          expect(distance).toBeGreaterThanOrEqual(30);
        }
      }
    },
  );

  test("Handles spawn failure when map is too crowded", async () => {
    const players: PlayerInfo[] = [];

    // Try to spawn more players than possible on a small map
    for (let i = 0; i < 5; i++) {
      players.push(
        new PlayerInfo(
          `player${i}`,
          PlayerType.Human,
          `client_id${i}`,
          `player_id${i}`,
        ),
      );
    }

    const game = await setup("half_land_half_ocean", undefined, players);
    const executors = new PlayerSpawner(game, "game_id").spawnPlayers();

    // Should spawn fewer than requested when map is too small
    expect(executors.length).toBe(1);
  });
});
