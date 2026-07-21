import path from "path";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { GameConfig } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";

// tests/util, so Setup resolves its map paths relative to it (../testdata/maps).
const UTIL_DIR = path.join(__dirname, "..", "..", "util");

// Keep the game in the spawn phase (setup() ends it by default), for asserting
// that a client-requested spawn is accepted while the phase is open.
function setupSpawnPhase(
  mapName: string,
  gameConfig: Partial<GameConfig>,
  players: PlayerInfo[],
) {
  return setup(mapName, gameConfig, players, UTIL_DIR, TestConfig, false);
}

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

      const game = await setup(mapName, {}, players);

      game.addExecution(...spawnExecutions);
      game.executeNextTick();
      game.executeNextTick();

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

    const game = await setup("half_land_half_ocean", {}, players);

    game.addExecution(...spawnExecutions);
    game.executeNextTick();
    game.executeNextTick();

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

    const game = await setup("half_land_half_ocean", {}, [playerInfo]);

    game.addExecution(new SpawnExecution("game_id", playerInfo, 10));
    game.addExecution(new SpawnExecution("game_id", playerInfo, 20));
    game.executeNextTick();
    game.executeNextTick();

    expect(game.playerByClientID("client_id")?.spawnTile()).toBe(20);
    // Previous territory from first spawn should be relinquished
    expect(game.owner(10).isPlayer()).toBe(false);
  });

  test("Client spawn intent is accepted during the spawn phase", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setupSpawnPhase("half_land_half_ocean", {}, [
      playerInfo,
    ]);

    // fromIntent = true simulates a client "spawn" intent.
    game.addExecution(new SpawnExecution("game_id", playerInfo, 20, true));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.spawnTile()).toBe(20);
    expect(player.numTilesOwned()).toBeGreaterThan(0);
  });

  test("Client spawn intent after the spawn phase is ignored (anti-teleport)", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    // setup() ends the spawn phase by default, so the game is already underway.
    const game = await setup("half_land_half_ocean", {}, [playerInfo]);

    // Establish the player's territory (an internal/trusted spawn).
    game.addExecution(new SpawnExecution("game_id", playerInfo, 20));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.spawnTile()).toBe(20);
    const tilesBefore = player.numTilesOwned();
    expect(tilesBefore).toBeGreaterThan(0);

    // Malicious "teleport": a client spawn intent to a new tile after the phase
    // ended must be a deterministic no-op — the player keeps their original
    // spawn location and territory rather than relinquishing and re-conquering.
    game.addExecution(new SpawnExecution("game_id", playerInfo, 10, true));
    game.executeNextTick();
    game.executeNextTick();

    expect(player.spawnTile()).toBe(20);
    expect(player.numTilesOwned()).toBe(tilesBefore);
  });

  test("Client spawn intent after the spawn phase cannot spawn a never-spawned player", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setup("half_land_half_ocean", {}, [playerInfo]);

    // A client "spawn" intent once the phase has ended is ignored entirely.
    game.addExecution(new SpawnExecution("game_id", playerInfo, 20, true));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id");
    expect(player?.hasSpawned() ?? false).toBe(false);
    expect(game.owner(20).isPlayer()).toBe(false);
  });

  test("Internal spawns are not gated by the spawn phase", async () => {
    // Nations, bots and random-spawn placement queue a SpawnExecution during
    // the spawn phase, but it may land a tick after the phase ends (e.g. a
    // singleplayer human's spawn ends the phase early). These trusted spawns
    // (fromIntent = false) must still succeed.
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setup("half_land_half_ocean", {}, [playerInfo]);

    game.addExecution(new SpawnExecution("game_id", playerInfo, 20));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.spawnTile()).toBe(20);
    expect(player.numTilesOwned()).toBeGreaterThan(0);
  });

  test("Random spawn ignores client-specified tile", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setupSpawnPhase(
      "half_land_half_ocean",
      { randomSpawn: true },
      [playerInfo],
    );

    // Simulate a malicious client sending a spawn intent with a specific tile
    const maliciousTile = 10;
    game.addExecution(
      new SpawnExecution("game_id", playerInfo, maliciousTile, true),
    );
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.hasSpawned()).toBe(true);
    // The spawn tile should NOT be the client-specified tile —
    // random spawn must bypass the client's choice.
    expect(player.spawnTile()).not.toBe(maliciousTile);
    expect(player.spawnTile()).toEqual(expect.any(Number));
    expect(game.isLand(player.spawnTile()!)).toBe(true);
  });
});
