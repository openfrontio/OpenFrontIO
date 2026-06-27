import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const GAME_ID: GameID = "game_id";
const PLAYER_ID = "p_id";

async function spawnWith(
  randomSpawn: boolean,
  x: number,
  y: number,
): Promise<{ game: Game; injected: TileRef; spawnTile: TileRef | undefined }> {
  const game = await setup("plains", { randomSpawn });
  game.addPlayer(new PlayerInfo("p", PlayerType.Human, null, PLAYER_ID));
  const injected = game.map().ref(x, y);
  game.addExecution(
    new SpawnExecution(GAME_ID, game.player(PLAYER_ID).info(), injected),
  );
  game.executeNextTick(); // init the execution
  game.executeNextTick(); // run the execution
  return { game, injected, spawnTile: game.player(PLAYER_ID).spawnTile() };
}

describe("Random spawn cannot be overridden by a client-supplied tile", () => {
  test("non-random mode honors the requested tile", async () => {
    const { injected, spawnTile } = await spawnWith(false, 50, 50);
    expect(spawnTile).toBe(injected);
  });

  test("random mode ignores the injected tile", async () => {
    const a = await spawnWith(true, 50, 50);
    const b = await spawnWith(true, 60, 60);

    // The player still spawns on a valid land tile.
    expect(a.spawnTile).toBeDefined();
    expect(a.game.isLand(a.spawnTile!)).toBe(true);

    // If the injected tile were honored, the two runs would spawn at the two
    // distinct injected tiles. Because random spawn ignores it and uses the
    // deterministic per-player seed instead, both runs land on the same tile.
    expect(a.spawnTile).toBe(b.spawnTile);
  });
});
