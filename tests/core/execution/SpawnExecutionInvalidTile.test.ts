import path from "path";
import { beforeEach, describe, expect, test } from "vitest";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { Game, PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";

const gameID: GameID = "test_game";

// Map paths inside setup() resolve relative to tests/util, so point currentDir
// there when overriding later positional args.
const setupDir = path.join(__dirname, "../../util");

// executeNextTick() ticks already-inited executions first and only then inits
// newly added ones, so a freshly added execution does not actually run until
// the second call.
function runPendingExecutions(game: Game): void {
  game.executeNextTick();
  game.executeNextTick();
}

function firstSpawnableTile(game: Game): number {
  const map = game.map();
  for (let ref = 0; ref < map.width() * map.height(); ref++) {
    if (map.isLand(ref) && !map.isImpassable(ref)) return ref;
  }
  throw new Error("no spawnable land tile on test map");
}

describe("SpawnExecution rejects invalid tile refs", () => {
  let game: Game;
  let info: PlayerInfo;
  let validTile: number;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
    info = new PlayerInfo("spawner", PlayerType.Human, null, "spawner");
    game.addPlayer(info);
    validTile = firstSpawnableTile(game);
  });

  test("a valid spawn tile still spawns the player", () => {
    game.addExecution(new SpawnExecution(gameID, info, validTile));
    runPendingExecutions(game);

    const player = game.player(info.id);
    expect(player.hasSpawned()).toBe(true);
    expect(player.numTilesOwned()).toBeGreaterThan(0);
  });

  // A fractional ref passes a bare range check but indexes past the typed-array
  // terrain buffers, so it must never place territory.
  test("a fractional spawn tile is a no-op", () => {
    game.addExecution(new SpawnExecution(gameID, info, validTile + 0.5));
    runPendingExecutions(game);

    const player = game.player(info.id);
    expect(player.hasSpawned()).toBe(false);
    expect(player.numTilesOwned()).toBe(0);
  });

  test("an out-of-range spawn tile is a no-op", () => {
    const outOfRange = game.map().width() * game.map().height();
    game.addExecution(new SpawnExecution(gameID, info, outOfRange));
    runPendingExecutions(game);

    const player = game.player(info.id);
    expect(player.hasSpawned()).toBe(false);
    expect(player.numTilesOwned()).toBe(0);
  });
});

// During the spawn phase a player may legitimately move their spawn, so
// SpawnExecution relinquishes their tiles before picking the new location.
// The ref check has to run before that, or a malformed intent costs the sender
// their starting territory with nothing placed in its stead.
describe("SpawnExecution validates before relinquishing territory", () => {
  test("a malformed re-spawn leaves existing territory intact", async () => {
    const game = await setup(
      "ocean_and_land",
      {},
      [],
      setupDir,
      TestConfig,
      false,
    );
    expect(game.inSpawnPhase()).toBe(true);

    const info = new PlayerInfo("spawner", PlayerType.Human, null, "spawner");
    game.addPlayer(info);
    const validTile = firstSpawnableTile(game);

    game.addExecution(new SpawnExecution(gameID, info, validTile));
    runPendingExecutions(game);

    const player = game.player(info.id);
    const owned = player.numTilesOwned();
    expect(owned).toBeGreaterThan(0);

    game.addExecution(new SpawnExecution(gameID, info, validTile + 0.5));
    runPendingExecutions(game);

    expect(player.numTilesOwned()).toBe(owned);
  });
});
