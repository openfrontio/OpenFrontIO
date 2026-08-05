import { Executor } from "../../../src/core/execution/ExecutionManager";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { SpawnTimerExecution } from "../../../src/core/execution/SpawnTimerExecution";
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

    game.addExecution(new SpawnExecution("game_id", playerInfo, 20));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.spawnTile()).toBe(20);
    expect(player.numTilesOwned()).toBeGreaterThan(0);
  });

  test("Spawn intent after the spawn phase cannot relocate territory (anti-teleport)", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    // setup() ends the spawn phase by default, so the game is already underway.
    const game = await setup("half_land_half_ocean", {}, [playerInfo]);

    // Establish the player's territory with a legitimate first spawn.
    game.addExecution(new SpawnExecution("game_id", playerInfo, 20));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.spawnTile()).toBe(20);
    const tilesBefore = player.numTilesOwned();
    expect(tilesBefore).toBeGreaterThan(0);

    // Malicious "teleport": a spawn intent to a new tile after the game has
    // started must be a deterministic no-op — the player keeps their original
    // spawn location and territory rather than relinquishing and re-conquering.
    game.addExecution(new SpawnExecution("game_id", playerInfo, 10, true));
    game.executeNextTick();
    game.executeNextTick();

    expect(player.spawnTile()).toBe(20);
    expect(player.numTilesOwned()).toBe(tilesBefore);
  });

  // Reported against #4657: that fix gated on `!inSpawnPhase() &&
  // hasSpawned()`, so a player who never picked a spawn failed the second
  // condition and was exempt — free to drop into a live game wherever they
  // liked, with full knowledge of the map.
  test("Spawn intent after the spawn phase is ignored for a player who never spawned", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    // setup() ends the spawn phase, so this intent is issued into a live game.
    const game = await setup("half_land_half_ocean", {}, [playerInfo]);
    expect(game.inSpawnPhase()).toBe(false);

    game.addExecution(new SpawnExecution("game_id", playerInfo, 20, true));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.hasSpawned()).toBe(false);
    expect(player.numTilesOwned()).toBe(0);
  });

  test("Repeated spawn intents after the spawn phase all stay no-ops", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setup("half_land_half_ocean", {}, [playerInfo]);

    // A burst in one turn, then more across later turns.
    game.addExecution(
      new SpawnExecution("game_id", playerInfo, 20, true),
      new SpawnExecution("game_id", playerInfo, 10, true),
      new SpawnExecution("game_id", playerInfo, 30, true),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.addExecution(new SpawnExecution("game_id", playerInfo, 40, true));
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.hasSpawned()).toBe(false);
    expect(player.numTilesOwned()).toBe(0);
  });

  // The gate must not punish a legitimate last-moment pick: that intent is
  // issued in-phase but its execution runs a tick later, once the phase has
  // already ended.
  test("Spawn intent issued on the final spawn-phase tick still lands on the chosen tile", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setup(
      "half_land_half_ocean",
      {},
      [playerInfo],
      undefined,
      undefined,
      false,
    );
    expect(game.inSpawnPhase()).toBe(true);
    game.addExecution(new SpawnTimerExecution());

    const lastPhaseTick = game.config().numSpawnPhaseTurns();
    let queued = false;
    for (let i = 0; i < lastPhaseTick + 5; i++) {
      if (!queued && game.ticks() >= lastPhaseTick) {
        game.addExecution(new SpawnExecution("game_id", playerInfo, 20, true));
        queued = true;
      }
      game.executeNextTick();
    }

    // The phase ended before the execution ticked, yet the pick is honoured
    // at the tile the player actually chose.
    expect(game.inSpawnPhase()).toBe(false);
    const player = game.playerByClientID("client_id")!;
    expect(player.spawnTile()).toBe(20);
    expect(player.numTilesOwned()).toBeGreaterThan(0);
  });

  // Locks the wiring: the gate is only meaningful if the intent path actually
  // marks its executions as client-sourced.
  test("Executor marks spawn intents as client-sourced", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setup("half_land_half_ocean", {}, [playerInfo]);
    const executor = new Executor(game, "game_id", "client_id");

    const exec = executor.createExec({
      type: "spawn",
      tile: 20,
      clientID: "client_id",
    } as never);

    game.addExecution(exec);
    game.executeNextTick();
    game.executeNextTick();

    const player = game.playerByClientID("client_id")!;
    expect(player.hasSpawned()).toBe(false);
  });

  test("Random spawn ignores client-specified tile", async () => {
    const playerInfo = new PlayerInfo(
      `player`,
      PlayerType.Human,
      `client_id`,
      `player_id`,
    );

    const game = await setup("half_land_half_ocean", { randomSpawn: true }, [
      playerInfo,
    ]);

    // Simulate a malicious client sending a spawn intent with a specific tile
    const maliciousTile = 10;
    game.addExecution(new SpawnExecution("game_id", playerInfo, maliciousTile));
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
