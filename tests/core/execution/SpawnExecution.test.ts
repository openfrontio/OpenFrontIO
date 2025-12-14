import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

describe("Spawn execution", () => {
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
      const spawnExecutions: SpawnExecution[] = [];
      for (let i = 0; i < maxPlayers; i++) {
        const playerInfo = new PlayerInfo(
          `player${i}`,
          PlayerType.Human,
          `client_id${i}`,
          `player_id${i}`,
        );
        players.push(playerInfo);

        spawnExecutions.push(new SpawnExecution("game_id", playerInfo));
      }

      const game = await setup(mapName, undefined, players);

      game.addExecution(...spawnExecutions);

      while (game.inSpawnPhase()) {
        game.executeNextTick();
      }

      game.allPlayers().forEach((player) => {
        const spawnTile = player.spawnTile()!;
        expect(spawnTile).toEqual(expect.any(Number));
        expect(game.isLand(spawnTile)).toBe(true);
        expect(game.isBorder(spawnTile)).toBe(false);
      });

      for (let i = 0; i < game.allPlayers().length; i++) {
        for (let j = i + 1; j < game.allPlayers().length; j++) {
          const distance = game.manhattanDist(
            game.allPlayers()[i].spawnTile()!,
            game.allPlayers()[j].spawnTile()!,
          );
          expect(distance).toBeGreaterThanOrEqual(
            game.config().minDistanceBetweenPlayers(),
          );
        }
      }
    },
  );

  test("Handles spawn failure when map is too crowded", async () => {
    const players: PlayerInfo[] = [];
    const spawnExecutions: SpawnExecution[] = [];

    // Try to spawn more players than possible on a small map
    for (let i = 0; i < 5; i++) {
      const playerInfo = new PlayerInfo(
        `player${i}`,
        PlayerType.Human,
        `client_id${i}`,
        `player_id${i}`,
      );
      players.push(playerInfo);

      spawnExecutions.push(new SpawnExecution("game_id", playerInfo));
    }

    const game = await setup("half_land_half_ocean", undefined, players);

    game.addExecution(...spawnExecutions);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    // Should spawn fewer than requested when map is too small
    expect(
      game.allPlayers().filter((player) => player.spawnTile() !== undefined)
        .length,
    ).toBe(1);
  });

  test("Spawn on specific tile", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setup("half_land_half_ocean", undefined, [playerInfo]);

    game.addExecution(new SpawnExecution("game_id", playerInfo, 50));
    game.addExecution(new SpawnExecution("game_id", playerInfo, 60));

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    expect(game.playerByClientID("client_id")?.spawnTile()).toBe(60);
    // Previous territory from first spawn should be relinquished
    expect(game.owner(50).isPlayer()).toBe(false);
  });
});
