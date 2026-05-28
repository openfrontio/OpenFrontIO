import { PreviewAutoExpandExecution } from "../src/core/execution/PreviewAutoExpandExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { findCenterSpawnTile } from "../src/core/execution/Util";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const gameID: GameID = "game_id";

describe("findCenterSpawnTile", () => {
  test("returns an unowned land tile at/near the geometric centre", async () => {
    const game = await setup("plains", { isPreview: true });

    const tile = findCenterSpawnTile(game);
    expect(tile).not.toBeNull();
    if (tile === null) return;

    // The chosen tile must be spawnable land.
    expect(game.isLand(tile)).toBe(true);
    expect(game.hasOwner(tile)).toBe(false);

    // ...and it should be the centre tile (or very close to it) on an
    // all-land map.
    const cx = Math.floor(game.width() / 2);
    const cy = Math.floor(game.height() / 2);
    expect(Math.abs(game.x(tile) - cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(game.y(tile) - cy)).toBeLessThanOrEqual(2);
  });
});

describe("PreviewAutoExpandExecution", () => {
  let game: Game;
  let player: Player;

  beforeEach(async () => {
    game = await setup("plains", { isPreview: true, infiniteTroops: true });
    const info = new PlayerInfo(
      "previewer",
      PlayerType.Human,
      null,
      "preview_id",
    );
    game.addPlayer(info);

    const center = findCenterSpawnTile(game);
    expect(center).not.toBeNull();
    game.addExecution(new SpawnExecution(gameID, info, center!));
    game.executeNextTick();
    game.executeNextTick();
    player = game.player(info.id);
  });

  test("floods the player across the wilderness and keeps the army huge", async () => {
    const tilesAfterSpawn = player.numTilesOwned();
    expect(player.isAlive()).toBe(true);

    game.addExecution(new PreviewAutoExpandExecution());
    // Several rings per tick, so just a few ticks balloons the territory.
    for (let i = 0; i < 3; i++) {
      game.executeNextTick();
    }

    expect(player.numTilesOwned()).toBeGreaterThan(tilesAfterSpawn * 10);

    // The army is kept topped up rather than left at the ~100k natural start.
    expect(player.troops()).toBe(100_000_000);
  });

  test("stops growing once the whole map is owned", async () => {
    game.addExecution(new PreviewAutoExpandExecution());
    // ~10 rings/tick fills a 100x100 all-land map from the centre quickly.
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
    }
    const filled = player.numTilesOwned();

    game.executeNextTick();
    game.executeNextTick();
    // No unclaimed land left, so the count is stable.
    expect(player.numTilesOwned()).toBe(filled);
    expect(filled).toBeGreaterThan(9000);
  });
});
