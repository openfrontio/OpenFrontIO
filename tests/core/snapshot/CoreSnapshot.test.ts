import { WinCheckExecution } from "../../../src/core/execution/WinCheckExecution";
import {
  Game,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { GameImpl } from "../../../src/core/game/GameImpl";
import {
  restoreMapsFromSnapshot,
  snapshotGame,
} from "../../../src/core/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import {
  diffGraphs,
  diffSnapshots,
  loadTestMaps,
  roundTrip,
} from "../../util/Snapshot";

const MAP = "plains";

async function builtGame(): Promise<Game> {
  const game = await setup(MAP, { infiniteGold: true, instantBuild: true });
  const a = game.addPlayer(
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
  );
  const b = game.addPlayer(
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
  );
  game.addPlayer(new PlayerInfo("bot", PlayerType.Bot, null, "bot"));
  for (let x = 5; x < 15; x++) {
    for (let y = 5; y < 15; y++) a.conquer(game.ref(x, y));
  }
  for (let x = 20; x < 30; x++) {
    for (let y = 5; y < 15; y++) b.conquer(game.ref(x, y));
  }
  a.setSpawnTile(game.ref(10, 10));
  b.setSpawnTile(game.ref(25, 10));
  a.buildUnit(UnitType.City, game.ref(8, 8), {});
  const port = b.buildUnit(UnitType.DefensePost, game.ref(22, 8), {});
  b.relinquish(game.ref(29, 14));
  a.addGold(12345n);
  b.addTroops(777);
  a.addEmbargo(b, false);
  a.updateRelation(b, -50);
  const g = game as GameImpl;
  g.createAllianceRequest(a, b)?.accept();
  g.createAllianceRequest(b, game.player("bot"));
  game.setFallout(game.ref(40, 40), true);
  game.addExecution(new WinCheckExecution());
  for (let i = 0; i < 5; i++) game.executeNextTick();
  port.delete();
  return game;
}

describe("core snapshot", () => {
  test("restores core objects exactly", async () => {
    const game = await builtGame();
    const { bytes, restored, again } = await roundTrip(game, MAP);
    expect(diffGraphs(game, restored)).toEqual([]);
    expect(diffSnapshots(bytes, again)).toEqual([]);
  });

  test("restored game keeps ticking identically", async () => {
    const game = await builtGame();
    const { restored } = await roundTrip(game, MAP);
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  });

  test("restoreMapsFromSnapshot restores tile ownership and map state", async () => {
    const game = await builtGame();
    const bytes = snapshotGame(game);
    const { gameMap, miniGameMap } = await loadTestMaps(MAP);
    restoreMapsFromSnapshot(bytes, gameMap, miniGameMap);

    const a = game.player("alice");
    expect(gameMap.ownerID(game.ref(10, 10))).toBe(a.smallID());
    expect(gameMap.ownerID(game.ref(8, 8))).toBe(a.smallID());
    const b = game.player("bob");
    expect(gameMap.ownerID(game.ref(25, 10))).toBe(b.smallID());
    expect(gameMap.hasFallout(game.ref(40, 40))).toBe(true);
  });
});
