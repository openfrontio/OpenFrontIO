import { describe, expect, it } from "vitest";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { getSpawnTiles } from "../../../src/core/execution/Util";
import { Game } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import {
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/GameTypes";
import { playerInfo, setup } from "../../util/Setup";

function findTestTiles(game: Game) {
  let landTileA: TileRef | undefined;
  let nudgeTile: TileRef | undefined;
  let landTileB: TileRef | undefined;
  let oceanTile: TileRef | undefined;

  for (let x = 0; x < game.width(); x++) {
    for (let y = 0; y < game.height(); y++) {
      const ref = game.ref(x, y);
      if (
        !oceanTile &&
        game.isOcean(ref) &&
        getSpawnTiles(game, ref, false).length === 0
      ) {
        oceanTile = ref;
      }
      if (!landTileA && game.isLand(ref)) {
        const tiles = getSpawnTiles(game, ref, false);
        if (tiles.length > 1) {
          landTileA = ref;
          nudgeTile = tiles[1];
        }
      }
    }
  }

  if (landTileA) {
    for (let x = game.width() - 1; x >= 0; x--) {
      for (let y = game.height() - 1; y >= 0; y--) {
        const ref = game.ref(x, y);
        if (game.isLand(ref) && game.manhattanDist(ref, landTileA) >= 4) {
          if (getSpawnTiles(game, ref, false).length > 0) {
            landTileB = ref;
            break;
          }
        }
      }
      if (landTileB) break;
    }
  }

  if (
    landTileA === undefined ||
    nudgeTile === undefined ||
    landTileB === undefined ||
    oceanTile === undefined
  ) {
    throw new Error(
      `Could not find test tiles: landTileA=${landTileA}, nudgeTile=${nudgeTile}, landTileB=${landTileB}, oceanTile=${oceanTile}, w=${game.width()}, h=${game.height()}`,
    );
  }
  return { landTileA, nudgeTile, landTileB, oceanTile };
}

describe("SpawnExecution spawn tile stat", () => {
  // playerInfo() gives a null clientID, and stats are keyed by clientID, so a
  // human with a client is built by hand here.
  const human = (name: string) =>
    new PlayerInfo(name, PlayerType.Human, `client_${name}`, name);

  const spawnAt = (game: Game, info: PlayerInfo, tile?: TileRef) => {
    const exec = new SpawnExecution("test-game", info, tile, true);
    exec.init(game, 0);
    exec.tick(0);
  };

  async function spawnPhaseGame(infos: PlayerInfo[], randomSpawn = false) {
    return setup(
      "ocean_and_land",
      { gameType: GameType.Public, randomSpawn },
      infos,
      undefined,
      undefined,
      false,
    );
  }

  it("records the spawn centre, and a later re-pick overwrites it", async () => {
    const p1 = human("p1");
    const game = await spawnPhaseGame([p1]);
    const { landTileA, landTileB } = findTestTiles(game);

    spawnAt(game, p1, landTileA);
    expect(game.stats().stats()[p1.clientID!]?.spawnTile).toBe(landTileA);

    spawnAt(game, p1, landTileB);
    expect(game.stats().stats()[p1.clientID!]?.spawnTile).toBe(landTileB);
    expect(game.player(p1.id).spawnTile()).toBe(landTileB);
  });

  it("keeps the previous tile when a re-pick is rejected", async () => {
    const p1 = human("p1");
    const game = await spawnPhaseGame([p1]);
    const { landTileA, oceanTile } = findTestTiles(game);

    spawnAt(game, p1, landTileA);
    spawnAt(game, p1, oceanTile);

    expect(game.stats().stats()[p1.clientID!]?.spawnTile).toBe(landTileA);
  });

  it("records the tile the game chose under random spawn", async () => {
    const p1 = human("p1");
    const game = await spawnPhaseGame([p1], true);

    spawnAt(game, p1);

    const chosen = game.player(p1.id).spawnTile();
    expect(chosen).toEqual(expect.any(Number));
    expect(game.stats().stats()[p1.clientID!]?.spawnTile).toBe(chosen);
  });

  it("records nothing for a player without a client", async () => {
    const noClient = playerInfo("NoClient", PlayerType.Human);
    const game = await spawnPhaseGame([noClient]);
    const { landTileA } = findTestTiles(game);

    spawnAt(game, noClient, landTileA);

    expect(game.player(noClient.id).spawnTile()).toBe(landTileA);
    expect(Object.keys(game.stats().stats())).toEqual([]);
  });
});

describe("SpawnExecution Transactional Rollback & Self-Collision", () => {
  it("rolls back to previous tiles and spawn center on invalid placement (ocean)", async () => {
    const p1Info = playerInfo("Player 1", PlayerType.Human);
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Public },
      [p1Info],
      undefined,
      undefined,
      false,
    );
    const { landTileA, oceanTile } = findTestTiles(game);

    const initialSpawn = new SpawnExecution(
      "test-game",
      p1Info,
      landTileA,
      true,
    );
    initialSpawn.init(game, 0);
    initialSpawn.tick(0);

    const player = game.player(p1Info.id);
    const initialTiles = Array.from(player.tiles());
    expect(initialTiles.length).toBeGreaterThan(0);
    expect(player.spawnTile()).toBe(landTileA);

    const invalidSpawn = new SpawnExecution(
      "test-game",
      p1Info,
      oceanTile,
      true,
    );
    invalidSpawn.init(game, 0);
    invalidSpawn.tick(0);

    expect(player.spawnTile()).toBe(landTileA);
    expect(Array.from(player.tiles())).toEqual(initialTiles);
    expect(player.tiles().size).toBe(initialTiles.length);
  });

  it("rolls back when spawn target collides with opponent territory", async () => {
    const p1Info = playerInfo("P1", PlayerType.Human);
    const p2Info = playerInfo("P2", PlayerType.Human);
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Public },
      [p1Info, p2Info],
      undefined,
      undefined,
      false,
    );
    const { landTileA, landTileB } = findTestTiles(game);

    const s1 = new SpawnExecution("test-game", p1Info, landTileA, true);
    s1.init(game, 0);
    s1.tick(0);

    const s2 = new SpawnExecution("test-game", p2Info, landTileB, true);
    s2.init(game, 0);
    s2.tick(0);

    const p1 = game.player(p1Info.id);
    const p2 = game.player(p2Info.id);
    const p1OriginalTiles = Array.from(p1.tiles());
    const p2OriginalTiles = Array.from(p2.tiles());

    const collSpawn = new SpawnExecution("test-game", p1Info, landTileB, true);
    collSpawn.init(game, 0);
    collSpawn.tick(0);

    expect(p1.spawnTile()).toBe(landTileA);
    expect(Array.from(p1.tiles())).toEqual(p1OriginalTiles);
    expect(p2.spawnTile()).toBe(landTileB);
    expect(Array.from(p2.tiles())).toEqual(p2OriginalTiles);
  });

  it("succeeds when nudging or re-clicking own spawn without self-collision", async () => {
    const p1Info = playerInfo("P1", PlayerType.Human);
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Public },
      [p1Info],
      undefined,
      undefined,
      false,
    );
    const { landTileA, nudgeTile } = findTestTiles(game);

    const s1 = new SpawnExecution("test-game", p1Info, landTileA, true);
    s1.init(game, 0);
    s1.tick(0);

    const p1 = game.player(p1Info.id);
    expect(p1.spawnTile()).toBe(landTileA);

    const nudgeSpawn = new SpawnExecution("test-game", p1Info, nudgeTile, true);
    nudgeSpawn.init(game, 0);
    nudgeSpawn.tick(0);

    expect(p1.spawnTile()).toBe(nudgeTile);
    expect(p1.tiles().size).toBeGreaterThan(0);
    expect(Array.from(p1.tiles())).toContain(nudgeTile);
  });

  it("spawns a new player with 0 initial tiles normally", async () => {
    const p1Info = playerInfo("P1", PlayerType.Human);
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Public },
      [p1Info],
      undefined,
      undefined,
      false,
    );
    const { landTileA } = findTestTiles(game);

    const p1 = game.player(p1Info.id);
    expect(p1.hasSpawned()).toBe(false);
    expect(p1.tiles().size).toBe(0);

    const spawn = new SpawnExecution("test-game", p1Info, landTileA, true);
    spawn.init(game, 0);
    spawn.tick(0);

    expect(p1.hasSpawned()).toBe(true);
    expect(p1.spawnTile()).toBe(landTileA);
    expect(p1.tiles().size).toBeGreaterThan(0);
  });

  it("handles edge case of invalid spawn when player has no spawn, allowing later valid spawn", async () => {
    const p1Info = playerInfo("P1", PlayerType.Human);
    const game = await setup(
      "ocean_and_land",
      { gameType: GameType.Public },
      [p1Info],
      undefined,
      undefined,
      false,
    );
    const { landTileA, oceanTile } = findTestTiles(game);

    const p1 = game.player(p1Info.id);
    expect(p1.hasSpawned()).toBe(false);
    expect(p1.tiles().size).toBe(0);

    const invalidSpawn = new SpawnExecution(
      "test-game",
      p1Info,
      oceanTile,
      true,
    );
    invalidSpawn.init(game, 0);
    invalidSpawn.tick(0);

    expect(p1.hasSpawned()).toBe(false);
    expect(p1.tiles().size).toBe(0);
    expect(p1.spawnTile()).toBeUndefined();

    const validSpawn = new SpawnExecution("test-game", p1Info, landTileA, true);
    validSpawn.init(game, 0);
    validSpawn.tick(0);

    expect(p1.hasSpawned()).toBe(true);
    expect(p1.spawnTile()).toBe(landTileA);
    expect(p1.tiles().size).toBeGreaterThan(0);
  });
});
