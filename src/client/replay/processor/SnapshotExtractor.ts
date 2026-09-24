/**
 * Extracts a playable singleplayer game snapshot from a GameRecord at a given tick.
 * Converts other human players into AI bots (NationExecution) and binds the chosen player
 * to the local clientID.
 */

import { NationExecution } from "../../../core/execution/NationExecution";
import { TribeExecution } from "../../../core/execution/TribeExecution";
import {
  Difficulty,
  Execution,
  GameType,
  Nation,
  PlayerID,
  PlayerInfo,
  PlayerType,
} from "../../../core/game/Game";
import { GameMapLoader } from "../../../core/game/GameMapLoader";
import { createGameRunner } from "../../../core/GameRunner";
import { ClientID, GameRecord, GameStartInfo } from "../../../core/Schemas";
import { decompressGameRecord, generateID } from "../../../core/Util";
import { wireGameStartInfo } from "./ReplayProcessor";

interface InternalGame {
  executions(): Execution[];
  removeExecution(exec: Execution): void;
  _humans: PlayerInfo[];
  _nations: Nation[];
}

export interface ExtractSnapshotOptions {
  record: GameRecord;
  targetTick: number;
  chosenPlayerID: PlayerID;
  localClientID: ClientID;
  difficulty?: Difficulty;
  mapLoader: GameMapLoader;
}

export interface ExtractedSnapshotResult {
  snapshot: Uint8Array;
  gameStartInfo: GameStartInfo;
}

/**
 * Re-runs a game record headless up to targetTick, configures the chosen player
 * as the local human player and converts all other players to AI bots, then captures
 * a snapshot ready for singleplayer game resumption.
 */
export async function extractSnapshotFromRecord(
  opts: ExtractSnapshotOptions,
): Promise<ExtractedSnapshotResult> {
  const { turns } = decompressGameRecord({ ...opts.record });
  const gameStart = wireGameStartInfo(opts.record);

  let tickError: string | undefined;
  const runner = await createGameRunner(
    gameStart,
    undefined,
    opts.mapLoader,
    (gu) => {
      if ("errMsg" in gu) {
        tickError = `${gu.errMsg}\n${gu.stack ?? ""}`;
      }
    },
  );

  const game = runner.game;
  const target = Math.max(0, opts.targetTick);

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.turnNumber > target) break;
    runner.addTurn(turn);
    if (!runner.executeNextTick() || tickError !== undefined) {
      throw new Error(
        `simulation failed at turn ${turn.turnNumber}: ${tickError ?? "tick did not execute"}`,
      );
    }
    if (game.ticks() >= target) break;
  }

  const chosenPlayer =
    (game.hasPlayer(opts.chosenPlayerID)
      ? game.player(opts.chosenPlayerID)
      : null) ??
    game.playerByClientID(opts.chosenPlayerID) ??
    game.players().find((p) => p.name() === opts.chosenPlayerID) ??
    null;
  if (!chosenPlayer) {
    throw new Error(`Player with ID ${opts.chosenPlayerID} not found`);
  }

  const gameImpl = game as unknown as InternalGame;

  // Remove existing AI executions from chosenPlayer if it was previously an AI nation or tribe
  for (const exec of gameImpl.executions()) {
    if (
      exec instanceof NationExecution &&
      exec.playerID() === chosenPlayer.id()
    ) {
      gameImpl.removeExecution(exec);
    } else if (
      exec instanceof TribeExecution &&
      exec.playerID() === chosenPlayer.id()
    ) {
      gameImpl.removeExecution(exec);
    }
  }

  // Update chosen player to be the local human
  const chosenInfo = chosenPlayer.info();
  const updatedChosenInfo = new PlayerInfo(
    chosenInfo.name,
    PlayerType.Human,
    opts.localClientID,
    chosenInfo.id,
    chosenInfo.isLobbyCreator,
    chosenInfo.clanTag,
    chosenInfo.friends,
    chosenInfo.teamIndex,
    chosenInfo.nationFlag,
  );
  (chosenPlayer as unknown as { playerInfo: PlayerInfo }).playerInfo =
    updatedChosenInfo;

  gameImpl._humans = gameImpl._humans.filter((h) => h.id !== chosenPlayer.id());
  gameImpl._humans.push(updatedChosenInfo);
  gameImpl._nations = gameImpl._nations.filter(
    (n) => n.playerInfo.id !== chosenPlayer.id(),
  );

  // Convert other players to Nation bots
  for (const p of game.allPlayers()) {
    if (p.id() === chosenPlayer.id()) continue;
    if (!game.inSpawnPhase() && !p.isAlive()) continue;

    if (p.type() === PlayerType.Human) {
      const pInfo = p.info();
      const updatedBotInfo = new PlayerInfo(
        pInfo.name,
        PlayerType.Nation,
        null,
        pInfo.id,
        false,
        pInfo.clanTag,
        pInfo.friends,
        pInfo.teamIndex,
        pInfo.nationFlag,
      );
      (p as unknown as { playerInfo: PlayerInfo }).playerInfo = updatedBotInfo;

      gameImpl._humans = gameImpl._humans.filter((h) => h.id !== p.id());
      const spawnTile = p.spawnTile();
      const spawnCell =
        spawnTile !== undefined ? game.cell(spawnTile) : undefined;
      const nation = new Nation(spawnCell, updatedBotInfo);
      if (!gameImpl._nations.some((n) => n.playerInfo.id === p.id())) {
        gameImpl._nations.push(nation);
      }

      const nationExec = new NationExecution(gameStart.gameID, nation);
      game.addExecution(nationExec);
    }
  }

  // Update game configuration
  const config = game.config().gameConfig() as {
    difficulty?: Difficulty;
    gameType: GameType;
  };
  if (opts.difficulty !== undefined) {
    config.difficulty = opts.difficulty;
  }
  config.gameType = GameType.Singleplayer;

  const snapshot = runner.snapshot();

  const originalClientID = chosenInfo.clientID;
  const originalCosmetics =
    (originalClientID !== null
      ? gameStart.players.find((p) => p.clientID === originalClientID)
          ?.cosmetics
      : undefined) ?? {};

  const newGameID = generateID();
  const singlePlayerGameStart: GameStartInfo = {
    ...gameStart,
    gameID: newGameID,
    players: [
      {
        clientID: opts.localClientID,
        username: chosenPlayer.name(),
        clanTag: chosenPlayer.clanTag(),
        cosmetics: originalCosmetics,
      },
    ],
    config: {
      ...game.config().gameConfig(),
      gameType: GameType.Singleplayer,
    },
  };

  return {
    snapshot,
    gameStartInfo: singlePlayerGameStart,
  };
}
