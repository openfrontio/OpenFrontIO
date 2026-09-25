import { describe, expect, test } from "vitest";
import { extractSnapshotFromRecord } from "../../../src/client/replay/processor/SnapshotExtractor";
import { NationExecution } from "../../../src/core/execution/NationExecution";
import { TribeExecution } from "../../../src/core/execution/TribeExecution";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
} from "../../../src/core/game/Game";
import { createGameRunnerFromSnapshot } from "../../../src/core/GameRunner";
import { config, human, mapLoader, playAndArchive } from "./util/ArchiveGame";

describe("SnapshotExtractor", () => {
  test("extracts playable snapshot at target tick and converts other humans to bots", async () => {
    const p1 = human(1);
    const p2 = human(2);

    const gameConfig = config({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      bots: 2,
    });

    const { record } = await playAndArchive({
      gameID: "TEST0001",
      config: gameConfig,
      players: [p1, p2],
      ticks: 40,
    });

    // Extract snapshot at tick 20, taking over as Human 2
    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 20,
      chosenPlayerID: "client002",
      localClientID: "MYCLIENT1",
      difficulty: Difficulty.Hard,
      mapLoader,
    });

    expect(result.snapshot).toBeInstanceOf(Uint8Array);
    expect(result.gameStartInfo.config.gameType).toBe(GameType.Singleplayer);
    expect(result.gameStartInfo.config.difficulty).toBe(Difficulty.Hard);
    expect(result.gameStartInfo.players.length).toBe(1);
    expect(result.gameStartInfo.players[0].username).toBe("Human 2");
    expect(result.gameStartInfo.players[0].clientID).toBe("MYCLIENT1");

    // Restore the runner from snapshot
    let updateReceived = false;
    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT1",
      mapLoader,
      (gu) => {
        if (!("errMsg" in gu)) {
          updateReceived = true;
        }
      },
    );

    const game = restoredRunner.game;
    expect(game.ticks()).toBe(20);

    // Verify Human 2 is local human
    const human2 = game.playerByClientID("MYCLIENT1");
    expect(human2).not.toBeNull();
    expect(human2?.name()).toBe("Human 2");
    expect(human2?.type()).toBe(PlayerType.Human);

    // Verify Human 1 was converted to Bot/Nation
    const human1 = game.allPlayers().find((p) => p.name() === "Human 1");
    expect(human1).not.toBeUndefined();
    expect(human1?.type()).toBe(PlayerType.Nation);
    expect(human1?.clientID()).toBeNull();

    // Verify game can continue ticking
    restoredRunner.addTurn({
      turnNumber: 20,
      intents: [],
    });
    const tickResult = restoredRunner.executeNextTick();
    expect(tickResult).toBe(true);
    expect(game.ticks()).toBe(21);
    expect(updateReceived).toBe(true);
  });

  test("can take over an AI nation and play as it", async () => {
    const p1 = human(1);

    const gameConfig = config({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      bots: 3,
    });

    const { record } = await playAndArchive({
      gameID: "TEST0002",
      config: gameConfig,
      players: [p1],
      ticks: 30,
    });

    // Find the name of one of the nations
    const nationName = record.info.players[1]?.username ?? "Oman";

    // Extract snapshot at tick 15, taking over as the nation
    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 15,
      chosenPlayerID: nationName,
      localClientID: "MYCLIENT2",
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT2",
      mapLoader,
      () => {},
    );

    const game = restoredRunner.game;
    expect(game.ticks()).toBe(15);

    const player = game.playerByClientID("MYCLIENT2");
    expect(player).not.toBeNull();
    expect(player?.name()).toBe(nationName);
    expect(player?.type()).toBe(PlayerType.Human);

    // Verify AI execution was removed for the chosen player
    for (const exec of (game as any).executions()) {
      if (exec instanceof NationExecution) {
        expect(exec.playerID()).not.toBe(player?.id());
      }
      if (exec instanceof TribeExecution) {
        expect(exec.playerID()).not.toBe(player?.id());
      }
    }

    restoredRunner.addTurn({ turnNumber: 15, intents: [] });
    expect(restoredRunner.executeNextTick()).toBe(true);
    expect(game.ticks()).toBe(16);
  });

  test("removes TribeExecution and NationExecution when taking over a bot", async () => {
    const p1 = human(1);
    const gameConfig = config({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      bots: 5,
    });

    const { record } = await playAndArchive({
      gameID: "TEST0003",
      config: gameConfig,
      players: [p1],
      ticks: 40,
    });

    const botName = "Oman";
    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 20,
      chosenPlayerID: botName,
      localClientID: "MYCLIENT3",
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT3",
      mapLoader,
      () => {},
    );

    const game = restoredRunner.game;
    const player = game.playerByClientID("MYCLIENT3");
    expect(player).not.toBeNull();
    expect(player?.type()).toBe(PlayerType.Human);

    for (const exec of (game as any).executions()) {
      if (exec instanceof NationExecution) {
        expect(exec.playerID()).not.toBe(player?.id());
      }
      if (exec instanceof TribeExecution) {
        expect(exec.playerID()).not.toBe(player?.id());
      }
    }
  });

  test("refreshes attack rate of existing active NationExecutions when difficulty changes", async () => {
    const p1 = human(1);
    const p2 = human(2);
    const gameConfig = config({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      bots: 2,
      difficulty: Difficulty.Easy,
    });

    const { record } = await playAndArchive({
      gameID: "TESTDIFF1",
      config: gameConfig,
      players: [p1, p2],
      ticks: 30,
    });

    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 20,
      chosenPlayerID: "client001",
      localClientID: "MYCLIENT_DIFF",
      difficulty: Difficulty.Impossible,
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT_DIFF",
      mapLoader,
      () => {},
    );

    const game = restoredRunner.game;
    const initializedNationExecs = (game as any)
      .executions()
      .filter(
        (e: unknown) =>
          e instanceof NationExecution && e.isActive() && e.isInitialized(),
      ) as NationExecution[];

    expect(initializedNationExecs.length).toBeGreaterThan(0);
    for (const exec of initializedNationExecs) {
      // Impossible difficulty has attack rate 30..50
      expect(exec.currentAttackRate()).toBeGreaterThanOrEqual(30);
      expect(exec.currentAttackRate()).toBeLessThanOrEqual(50);
      expect(exec.currentAttackTick()).toBeGreaterThanOrEqual(0);
      expect(exec.currentAttackTick()).toBeLessThan(exec.currentAttackRate());
    }

    // After adding a turn and ticking the restored runner, uninitialized executions initialize with the new difficulty
    restoredRunner.addTurn({ turnNumber: 20, intents: [] });
    expect(restoredRunner.executeNextTick()).toBe(true);

    const allNationExecs = (game as any)
      .executions()
      .filter(
        (e: unknown) => e instanceof NationExecution && e.isActive(),
      ) as NationExecution[];

    for (const exec of allNationExecs) {
      expect(exec.isInitialized()).toBe(true);
      expect(exec.currentAttackRate()).toBeGreaterThanOrEqual(30);
      expect(exec.currentAttackRate()).toBeLessThanOrEqual(50);
    }
  });
});
