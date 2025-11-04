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
    },
  );
});
