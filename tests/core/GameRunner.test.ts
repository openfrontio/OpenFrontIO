import { Executor } from "../../src/core/execution/ExecutionManager";
import { NationExecution } from "../../src/core/execution/NationExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import { Cell, Nation, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { GameRunner } from "../../src/core/GameRunner";
import { GameConfig, GameID, Turn } from "../../src/core/Schemas";
import { setup } from "../util/Setup";
import { executeTicks } from "../util/utils";

const gameID: GameID = "test_game_id";

describe("GameRunner turn queue", () => {
  async function createRunner() {
    const human = new PlayerInfo(
      "human",
      PlayerType.Human,
      "client_1",
      "human_id",
    );
    const game = await setup("plains", {}, [human]);
    const runner = new GameRunner(
      game,
      new Executor(game, gameID, "client_1"),
      () => {},
    );
    return { runner, player: game.player(human.id) };
  }

  function turn(turnNumber: number): Turn {
    return {
      turnNumber,
      intents: [
        {
          type: "mark_disconnected",
          clientID: "client_1",
          isDisconnected: turnNumber % 2 === 0,
        },
      ],
    };
  }

  // Inspect retention directly; garbage collection timing is nondeterministic.
  function retainedTurns(runner: GameRunner) {
    return (runner as unknown as { turns: (Turn | undefined)[] }).turns;
  }

  test("releases consumed turns before a backlog drains and accepts new turns after draining", async () => {
    const { runner, player } = await createRunner();
    const first = turn(0);
    const second = turn(1);
    runner.addTurn(first);
    runner.addTurn(second);

    expect(runner.executeNextTick()).toBe(true);
    expect(player.isDisconnected()).toBe(true);
    expect(runner.pendingTurns()).toBe(1);
    expect(retainedTurns(runner)).not.toContain(first);
    expect(retainedTurns(runner)).toContain(second);

    expect(runner.executeNextTick()).toBe(true);
    expect(player.isDisconnected()).toBe(false);
    expect(runner.pendingTurns()).toBe(0);
    expect(retainedTurns(runner)).toHaveLength(0);
    expect(runner.executeNextTick()).toBe(false);

    runner.addTurn(turn(2));
    expect(runner.executeNextTick()).toBe(true);
    expect(player.isDisconnected()).toBe(true);
    expect(runner.pendingTurns()).toBe(0);
    expect(retainedTurns(runner)).toHaveLength(0);
  });

  test("bounds consumed queue storage and preserves FIFO while turns arrive during catch-up", async () => {
    const { runner, player } = await createRunner();
    const backlog = 1500;
    for (let i = 0; i < backlog; i++) runner.addTurn(turn(i));

    // Keep a constant backlog long enough to require multiple compactions.
    for (let i = 0; i < 4500; i++) {
      expect(runner.executeNextTick()).toBe(true);
      expect(player.isDisconnected()).toBe(i % 2 === 0);
      runner.addTurn(turn(i + backlog));
      expect(runner.pendingTurns()).toBe(backlog);
      expect(retainedTurns(runner).length).toBeLessThanOrEqual(2 * backlog);
    }
    for (let i = 4500; i < 6000; i++) {
      expect(runner.executeNextTick()).toBe(true);
      expect(player.isDisconnected()).toBe(i % 2 === 0);
      expect(runner.pendingTurns()).toBe(5999 - i);
    }
    expect(retainedTurns(runner)).toHaveLength(0);
    expect(runner.executeNextTick()).toBe(false);
  });
});

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
