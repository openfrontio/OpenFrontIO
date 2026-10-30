import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnTimerExecution } from "@openfront/engine/execution/SpawnTimerExecution";
import { TribeExecution } from "@openfront/engine/execution/TribeExecution";
import { Player } from "@openfront/engine/game/Game";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
} from "@openfront/engine/GameRunner";
import { readSnapshotHeader } from "@openfront/engine/snapshot/GameSnapshot";
import { extractSnapshot } from "@openfront/engine/snapshot/SnapshotExtractor";
import { GameMapLoader, loadMapFiles } from "@openfront/shared/GameMapLoader";
import { decompressGameRecord, generateID } from "@openfront/shared/SharedUtil";
import { GameRecord } from "@openfront/shared/WireSchemas";
import { describe, expect, test } from "vitest";
import { wireGameStartInfo } from "../../../src/client/replay/processor/ReplayProcessor";
import {
  config,
  human,
  mapLoader,
  playAndArchive,
  spawnOnLand,
} from "./util/ArchiveGame";

const loadMap = (c: { gameMap: GameMapType; gameMapSize: GameMapSize }) =>
  loadMapFiles(mapLoader, c.gameMap, c.gameMapSize);

async function extractSnapshotFromRecord(opts: {
  record: GameRecord;
  targetTick: number;
  chosenPlayerID: string;
  localClientID: string;
  difficulty?: Difficulty;
  mapLoader: GameMapLoader;
}) {
  const { turns } = decompressGameRecord({ ...opts.record });
  const gameStart = wireGameStartInfo(opts.record);
  const mapFiles = await loadMapFiles(
    opts.mapLoader,
    gameStart.config.gameMap,
    gameStart.config.gameMapSize,
  );
  return extractSnapshot({
    gameStartInfo: gameStart,
    turns,
    mapFiles,
    targetTick: opts.targetTick,
    chosenPlayerID: opts.chosenPlayerID,
    localClientID: opts.localClientID,
    difficulty: opts.difficulty,
    newGameID: generateID(),
  });
}

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
    expect(result.tick).toBe(20);
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
      await loadMap(result.gameStartInfo.config),
      (gu: GameUpdateViewData | ErrorUpdate) => {
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
    const human1 = game
      .allPlayers()
      .find((p: Player) => p.name() === "Human 1");
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

    // Run to target tick to find a real nation player
    const preRunner = await createGameRunner(
      record.info,
      undefined,
      await loadMap(record.info.config),
      () => {},
    );
    const turns = decompressGameRecord(record).turns;
    for (let t = 0; t < 15; t++) {
      preRunner.addTurn(turns[t]);
      preRunner.executeNextTick();
    }
    const preGame = preRunner.game;
    const nationPlayer = preGame
      .players()
      .find((p: Player) => p.type() === PlayerType.Nation);
    expect(nationPlayer).toBeDefined();
    const nationID = nationPlayer!.id();
    const nationName = nationPlayer!.name();

    // Extract snapshot at tick 15, taking over as the nation
    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 15,
      chosenPlayerID: nationID,
      localClientID: "MYCLIENT2",
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT2",
      await loadMap(result.gameStartInfo.config),
      () => {},
    );

    const game = restoredRunner.game;
    expect(game.ticks()).toBe(15);

    const player = game.playerByClientID("MYCLIENT2");
    expect(player).not.toBeNull();
    expect(player?.id()).toBe(nationID);
    expect(player?.name()).toBe(nationName);
    expect(player?.type()).toBe(PlayerType.Human);

    // Verify AI execution was removed for the chosen player
    for (const exec of game.executions()) {
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
      tribes: [{ name: "SaharaNomads" }],
      ticks: 40,
    });

    // Before extraction, verify that the selected tribe exists and has a TribeExecution
    const preRunner = await createGameRunner(
      record.info,
      undefined,
      await loadMap(record.info.config),
      () => {},
    );
    const turns = decompressGameRecord(record).turns;
    for (let t = 0; t < 20; t++) {
      preRunner.addTurn(turns[t]);
      preRunner.executeNextTick();
    }
    const preGame = preRunner.game;
    const botPlayer = preGame
      .players()
      .find(
        (p: Player) =>
          p.type() === PlayerType.Bot && p.name() === "SaharaNomads",
      );
    expect(botPlayer).toBeDefined();

    const hasTribeExecBefore = (preGame as any)
      .executions()
      .some(
        (exec: any) =>
          exec instanceof TribeExecution && exec.playerID() === botPlayer!.id(),
      );
    expect(hasTribeExecBefore).toBe(true);

    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 20,
      chosenPlayerID: botPlayer!.id(),
      localClientID: "MYCLIENT3",
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT3",
      await loadMap(result.gameStartInfo.config),
      () => {},
    );

    const game = restoredRunner.game;
    const player = game.playerByClientID("MYCLIENT3");
    expect(player).not.toBeNull();
    expect(player?.type()).toBe(PlayerType.Human);
    expect(player?.id()).toBe(botPlayer!.id());

    let chosenHasTribeExec = false;
    let otherTribesExecCount = 0;
    for (const exec of game.executions()) {
      if (exec instanceof NationExecution) {
        expect(exec.playerID()).not.toBe(player?.id());
      }
      if (exec instanceof TribeExecution) {
        if (exec.playerID() === player?.id()) {
          chosenHasTribeExec = true;
        } else {
          otherTribesExecCount++;
        }
      }
    }
    expect(chosenHasTribeExec).toBe(false);
    expect(otherTribesExecCount).toBeGreaterThan(0);
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
      await loadMap(result.gameStartInfo.config),
      () => {},
    );

    const game = restoredRunner.game;
    const initializedNationExecs = (game as any)
      .executions()
      .filter(
        (e: unknown): e is NationExecution =>
          e instanceof NationExecution && e.isActive() && e.isInitialized(),
      );

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
        (e: unknown): e is NationExecution =>
          e instanceof NationExecution && e.isActive(),
      );

    for (const exec of allNationExecs) {
      expect(exec.isInitialized()).toBe(true);
      expect(exec.currentAttackRate()).toBeGreaterThanOrEqual(30);
      expect(exec.currentAttackRate()).toBeLessThanOrEqual(50);
    }
  });

  test("extracts playable snapshot at target tick 0 without executing turn 0", async () => {
    const p1 = human(1);
    const gameConfig = config({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      bots: 2,
    });

    const { record } = await playAndArchive({
      gameID: "TESTTICK0",
      config: gameConfig,
      players: [p1],
      ticks: 10,
    });

    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 0,
      chosenPlayerID: "client001",
      localClientID: "MYCLIENT0",
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT0",
      await loadMap(result.gameStartInfo.config),
      () => {},
    );

    const game = restoredRunner.game;
    expect(game.ticks()).toBe(0);
    expect(game.inSpawnPhase()).toBe(true);
  });

  test("clears eliminated human players from _humans so header has exactly 1 human", async () => {
    const p1 = human(1);
    const p2 = human(2);
    const p3 = human(3);

    const gameConfig = config({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      bots: 2,
    });

    const { record } = await playAndArchive({
      gameID: "DEAD0001",
      config: gameConfig,
      players: [p1, p2, p3],
      ticks: 210,
      intents: (game, t) => {
        // Spawn p1 and p2 during spawn phase, but do not spawn p3 so p3 is eliminated
        if (t === 2) {
          return [
            spawnOnLand(game, "client001", 100_000),
            spawnOnLand(game, "client002", 100_000),
          ];
        }
        return [];
      },
    });

    // Extract snapshot at tick 205 (post spawn phase), taking over p1
    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 205,
      chosenPlayerID: "client001",
      localClientID: "LOCAL_CHOSEN",
      difficulty: Difficulty.Medium,
      mapLoader,
    });

    const header = readSnapshotHeader(result.snapshot);
    expect(header.humans.length).toBe(1);
    expect(header.humans[0].clientID).toBe("LOCAL_CHOSEN");

    // Restore the runner to verify post-spawn dead human state
    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "LOCAL_CHOSEN",
      await loadMap(result.gameStartInfo.config),
      () => {},
    );

    expect(restoredRunner.game.inSpawnPhase()).toBe(false);

    // p3 was eliminated, so it was removed from humans and its clientID cleared
    const deadPlayer = restoredRunner.game.playerByClientID("client003");
    expect(deadPlayer).toBeNull();

    expect(
      restoredRunner.game.players().find((p) => p.name() === "Human 3"),
    ).toBeUndefined();

    const deadP3 = restoredRunner.game
      .allPlayers()
      .find((p) => p.name() === "Human 3");
    expect(deadP3).toBeDefined();
    expect(deadP3?.isAlive()).toBe(false);
    expect(deadP3?.type()).toBe(PlayerType.Nation);
    expect(deadP3?.clientID()).toBeNull();

    // Dead player should not have an active NationExecution
    const deadHasExec = restoredRunner.game
      .executions()
      .some(
        (exec: any) =>
          exec instanceof NationExecution && exec.playerID() === deadP3!.id(),
      );
    expect(deadHasExec).toBe(false);
  });

  test("clears unassigned/kicked humans from _humans other than chosen player", async () => {
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
      gameID: "KICK0001",
      config: gameConfig,
      players: [p1, p2],
      ticks: 20,
    });

    // Simulate extra human info in record (such as kicked human who never spawned as active player)
    const recordWithKicked = {
      ...record,
      info: {
        ...record.info,
        players: [...record.info.players, human(99)],
      },
    };

    const result = await extractSnapshotFromRecord({
      record: recordWithKicked as any,
      targetTick: 10,
      chosenPlayerID: "client001",
      localClientID: "LOCAL_CHOSEN",
      difficulty: Difficulty.Easy,
      mapLoader,
    });

    const header = readSnapshotHeader(result.snapshot);
    expect(header.humans.length).toBe(1);
    expect(header.humans[0].clientID).toBe("LOCAL_CHOSEN");
  });

  test("preserves spawn phase without timer cutoff when extracting unspawned player between ticks 101 and 199", async () => {
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
      gameID: "SPAWN001",
      config: gameConfig,
      players: [p1, p2],
      ticks: 160,
      intents: (game, t) => {
        // Spawn p1 only; p2 remains unspawned throughout
        if (t === 2) {
          return [spawnOnLand(game, "client001", 100_000)];
        }
        return [];
      },
    });

    // Extract at tick 150 as the unspawned p2
    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 150,
      chosenPlayerID: "client002",
      localClientID: "MYCLIENT2",
      difficulty: Difficulty.Medium,
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT2",
      await loadMap(result.gameStartInfo.config),
      () => {},
    );

    const game = restoredRunner.game;
    expect(game.ticks()).toBe(150);
    // Should still be in spawn phase because human hasn't spawned yet
    expect(game.inSpawnPhase()).toBe(true);

    // SpawnTimerExecution must be removed so it doesn't end the spawn phase prematurely
    const hasSpawnTimer = game
      .executions()
      .some((e) => e instanceof SpawnTimerExecution);
    expect(hasSpawnTimer).toBe(false);

    // Run a tick past tick 150 (would have exceeded singleplayer 100 limit if timer was still present)
    restoredRunner.addTurn({
      turnNumber: 150,
      intents: [],
    });
    const tickResult = restoredRunner.executeNextTick();
    expect(tickResult).toBe(true);
    expect(game.ticks()).toBe(151);
    expect(game.inSpawnPhase()).toBe(true);
  });

  test("spawns unspawned human as nation bot when extracting spawned player mid-spawn-phase", async () => {
    const p1 = human(1);
    const p2 = human(2);

    const gameConfig = config({
      gameMap: GameMapType.World,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Public,
      bots: 0,
    });

    const { record } = await playAndArchive({
      gameID: "SPAWN002",
      config: gameConfig,
      players: [p1, p2],
      ticks: 30,
      intents: (game, t) => {
        // Spawn p1 only; p2 remains unspawned
        if (t === 2) {
          return [spawnOnLand(game, "client001", 100_000)];
        }
        return [];
      },
    });

    // Extract at tick 20 as the spawned p1
    const result = await extractSnapshotFromRecord({
      record,
      targetTick: 20,
      chosenPlayerID: "client001",
      localClientID: "MYCLIENT1",
      difficulty: Difficulty.Medium,
      mapLoader,
    });

    const restoredRunner = await createGameRunnerFromSnapshot(
      result.gameStartInfo,
      result.snapshot,
      "MYCLIENT1",
      await loadMap(result.gameStartInfo.config),
      () => {},
    );

    const game = restoredRunner.game;
    expect(game.ticks()).toBe(20);
    // Chosen player had already spawned, so spawn phase is ended for singleplayer
    expect(game.inSpawnPhase()).toBe(false);

    // Chosen player is alive with the local clientID
    const chosen = game.playerByClientID("MYCLIENT1");
    expect(chosen).toBeDefined();
    expect(chosen!.isAlive()).toBe(true);

    // Unspawned p2 was converted to a nation bot and spawned rather than dropping out
    const convertedP2 = game.allPlayers().find((p) => p.name() === "Human 2");
    expect(convertedP2).toBeDefined();
    expect(convertedP2!.type()).toBe(PlayerType.Nation);
    expect(convertedP2!.hasSpawned()).toBe(true);
    expect(convertedP2!.isAlive()).toBe(true);

    // Converted nation bot has an active NationExecution
    const nationExec = game
      .executions()
      .find(
        (e): e is NationExecution =>
          e instanceof NationExecution && e.playerID() === convertedP2!.id(),
      );
    expect(nationExec).toBeDefined();
    expect(nationExec!.isActive()).toBe(true);

    // Execute next tick post-spawn-phase: nation does not deactivate/drop out
    restoredRunner.addTurn({
      turnNumber: 20,
      intents: [],
    });
    const tickResult = restoredRunner.executeNextTick();
    expect(tickResult).toBe(true);
    expect(game.ticks()).toBe(21);
    expect(convertedP2!.isAlive()).toBe(true);
    expect(nationExec!.isActive()).toBe(true);
  });
});
