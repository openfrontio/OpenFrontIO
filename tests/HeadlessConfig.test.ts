import { AttackExecution } from "../src/core/execution/AttackExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { playerInfo, setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

// Config.headless() (bot lab) skips the per-tick render updates and the sync hash. They are outputs, not
// state: the simulation must be bit-identical with the flag on or off.
class HeadlessConfig extends TestConfig {
  headless(): boolean {
    return true;
  }
}

async function play(
  ConfigClass: typeof TestConfig,
): Promise<{
  game: Game;
  a: Player;
  b: Player;
  playerUpdates: number;
  hashUpdates: number;
}> {
  const game = await setup(
    "plains",
    {},
    [playerInfo("a", PlayerType.Human), playerInfo("b", PlayerType.Human)],
    undefined,
    ConfigClass,
  );
  const a = game.player("a"),
    b = game.player("b");
  a.conquer(game.ref(10, 10));
  a.addTroops(5000);
  b.conquer(game.ref(40, 40));
  b.addTroops(2000);
  game.addExecution(
    new AttackExecution(1000, a, null),
    new AttackExecution(500, b, null),
  );
  let playerUpdates = 0,
    hashUpdates = 0;
  for (let i = 0; i < 60; i++) {
    const u = game.executeNextTick();
    playerUpdates += u[GameUpdateType.Player].length;
    hashUpdates += u[GameUpdateType.Hash].length;
  }
  return { game, a, b, playerUpdates, hashUpdates };
}

describe("Config.headless", () => {
  test("is off by default and emits player + hash updates", async () => {
    const r = await play(TestConfig);
    expect(r.game.config().headless()).toBe(false);
    expect(r.playerUpdates).toBeGreaterThan(0);
    expect(r.hashUpdates).toBeGreaterThan(0);
  });

  test("headless emits no player/hash updates and leaves the simulation identical", async () => {
    const normal = await play(TestConfig);
    const headless = await play(HeadlessConfig);
    expect(headless.playerUpdates).toBe(0);
    expect(headless.hashUpdates).toBe(0);
    for (const [n, h] of [
      [normal.a, headless.a],
      [normal.b, headless.b],
    ]) {
      expect(h.numTilesOwned()).toBe(n.numTilesOwned());
      expect(h.troops()).toBe(n.troops());
      expect(h.borderTiles().size).toBe(n.borderTiles().size);
    }
    expect(normal.a.numTilesOwned()).toBeGreaterThan(1);
  });
});
