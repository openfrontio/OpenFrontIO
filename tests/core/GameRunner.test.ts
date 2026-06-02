import { NationExecution } from "../../src/core/execution/NationExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { Cell, Nation, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";
import { executeTicks } from "../util/utils";

const gameID: GameID = "test_game_id";

describe("Nation spawn ordering with random spawn", () => {
  test("nation spawns in singleplayer with random spawn", async () => {
    const game = await setup(
      "plains",
      { randomSpawn: true },
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

    const nationInfo = new PlayerInfo(
      "TestNation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    const nation = new Nation(new Cell(50, 50), nationInfo);
    game.addPlayer(nationInfo);

    // Mirror GameRunner.init() ordering: nation first, then human.
    game.addExecution(new NationExecution(gameID, nation));
    game.addExecution(
      new SpawnExecution(gameID, game.player(humanInfo.id).info()),
    );

    // Tick 1: init executions.  Tick 2: NationExecution queues SpawnExecution,
    // human SpawnExecution spawns + ends spawn phase.  Tick 3: nation
    // SpawnExecution fires.
    executeTicks(game, 4);

    expect(game.player(humanInfo.id).hasSpawned()).toBe(true);
    expect(game.player(nationInfo.id).hasSpawned()).toBe(true);
    expect(game.player(nationInfo.id).isAlive()).toBe(true);
  });

  test("multiple nations spawn in singleplayer with random spawn", async () => {
    const game = await setup(
      "plains",
      { randomSpawn: true },
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

    const nationInfos: PlayerInfo[] = [];
    const nations: Nation[] = [];
    for (let i = 0; i < 5; i++) {
      const info = new PlayerInfo(
        `Nation${i}`,
        PlayerType.Nation,
        null,
        `nation_${i}`,
      );
      nationInfos.push(info);
      nations.push(new Nation(new Cell(20 + i * 15, 20 + i * 15), info));
      game.addPlayer(info);
    }

    // Nation executions first (mirrors GameRunner.init()).
    for (const n of nations) {
      game.addExecution(new NationExecution(gameID, n));
    }
    // Human spawn execution second.
    game.addExecution(
      new SpawnExecution(gameID, game.player(humanInfo.id).info()),
    );

    executeTicks(game, 8);

    expect(game.player(humanInfo.id).hasSpawned()).toBe(true);
    for (const info of nationInfos) {
      const player = game.player(info.id);
      expect(player.hasSpawned()).toBe(true);
      expect(player.isAlive()).toBe(true);
    }
  });

  test("nations spawn in singleplayer without random spawn", async () => {
    const game = await setup(
      "plains",
      { randomSpawn: false },
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

    const nationInfo = new PlayerInfo(
      "BaselineNation",
      PlayerType.Nation,
      null,
      "nation_baseline",
    );
    const nation = new Nation(new Cell(50, 50), nationInfo);
    game.addPlayer(nationInfo);

    game.addExecution(new NationExecution(gameID, nation));

    executeTicks(game, 4);

    expect(game.player(nationInfo.id).hasSpawned()).toBe(true);
    expect(game.player(nationInfo.id).isAlive()).toBe(true);
  });
});
