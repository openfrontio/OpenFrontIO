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

describe("SpawnExecution rejects invalid tile refs", () => {
  let game: Game;
  let info: PlayerInfo;
  let validTile: number;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
    info = new PlayerInfo("spawner", PlayerType.Human, null, "spawner");
    game.addPlayer(info);
    validTile = game.ref(0, 10);
  });

  test("a valid spawn tile still spawns the player", () => {
    game.addExecution(new SpawnExecution(gameID, info, validTile));
    game.executeNextTick();

    const player = game.player(info.id);
    expect(player.hasSpawned()).toBe(true);
    expect(player.numTilesOwned()).toBeGreaterThan(0);
  });

  // A fractional ref passes a bare range check but indexes past the typed-array
  // terrain buffers, so it must never place territory.
  test("a fractional spawn tile is a no-op", () => {
    game.addExecution(new SpawnExecution(gameID, info, validTile + 0.5));
    game.executeNextTick();

    const player = game.player(info.id);
    expect(player.hasSpawned()).toBe(false);
    expect(player.numTilesOwned()).toBe(0);
  });

  test("an out-of-range spawn tile is a no-op", () => {
    const outOfRange = game.map().width() * game.map().height();
    game.addExecution(new SpawnExecution(gameID, info, outOfRange));
    game.executeNextTick();

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

    game.addExecution(new SpawnExecution(gameID, info, game.ref(0, 10)));
    game.executeNextTick();

    const player = game.player(info.id);
    const owned = player.numTilesOwned();
    expect(owned).toBeGreaterThan(0);

    game.addExecution(new SpawnExecution(gameID, info, game.ref(0, 10) + 0.5));
    game.executeNextTick();

    expect(player.numTilesOwned()).toBe(owned);
  });
});
