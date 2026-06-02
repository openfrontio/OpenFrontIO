import { NationExecution } from "../../src/core/execution/NationExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { Cell, Nation, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { GameConfig, GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";
import { executeTicks } from "../util/utils";

const gameID: GameID = "test_game_id";

async function createTestGame(
  randomSpawn: boolean,
  nationCells: { x: number; y: number }[],
) {
  const game = await setup(
    "plains",
    { randomSpawn } as Partial<GameConfig>,
    [],
    undefined,
    undefined,
    false,
  );

  const humanInfo = new PlayerInfo(
    "human",
    PlayerType.Human,
    "client_1",
    "human_id",
  );
  game.addPlayer(humanInfo);

  const nations: { info: PlayerInfo; nation: Nation }[] = [];
  for (let i = 0; i < nationCells.length; i++) {
    const info = new PlayerInfo(
      nationCells.length === 1 ? "TestNation" : `Nation${i}`,
      PlayerType.Nation,
      null,
      nationCells.length === 1 ? "nation_id" : `nation_${i}`,
    );
    const nation = new Nation(
      new Cell(nationCells[i].x, nationCells[i].y),
      info,
    );
    game.addPlayer(info);
    nations.push({ info, nation });
  }

  return { game, humanInfo, nations };
}

describe("Nation spawn ordering with random spawn", () => {
  test("nation spawns in singleplayer with random spawn", async () => {
    const { game, humanInfo, nations } = await createTestGame(true, [
      { x: 50, y: 50 },
    ]);

    // Mirror GameRunner.init() ordering: nation first, then human.
    game.addExecution(new NationExecution(gameID, nations[0].nation));
    game.addExecution(
      new SpawnExecution(gameID, game.player(humanInfo.id).info()),
    );

    executeTicks(game, 4);

    expect(game.player(humanInfo.id).hasSpawned()).toBe(true);
    expect(game.player(nations[0].info.id).hasSpawned()).toBe(true);
    expect(game.player(nations[0].info.id).isAlive()).toBe(true);
  });

  test("multiple nations spawn in singleplayer with random spawn", async () => {
    const cells = Array.from({ length: 5 }, (_, i) => ({
      x: 20 + i * 15,
      y: 20 + i * 15,
    }));
    const { game, humanInfo, nations } = await createTestGame(true, cells);

    // Nation executions first (mirrors GameRunner.init()).
    for (const { nation } of nations) {
      game.addExecution(new NationExecution(gameID, nation));
    }
    // Human spawn execution second.
    game.addExecution(
      new SpawnExecution(gameID, game.player(humanInfo.id).info()),
    );

    executeTicks(game, 8);

    expect(game.player(humanInfo.id).hasSpawned()).toBe(true);
    for (const { info } of nations) {
      const player = game.player(info.id);
      expect(player.hasSpawned()).toBe(true);
      expect(player.isAlive()).toBe(true);
    }
  });

  test("nation spawns in singleplayer without random spawn", async () => {
    const { game, nations } = await createTestGame(false, [{ x: 50, y: 50 }]);

    game.addExecution(new NationExecution(gameID, nations[0].nation));

    executeTicks(game, 4);

    expect(game.player(nations[0].info.id).hasSpawned()).toBe(true);
    expect(game.player(nations[0].info.id).isAlive()).toBe(true);
  });
});
