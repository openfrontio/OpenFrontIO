/**
 * Extracts a playable singleplayer game snapshot from a GameRecord at a given tick.
 * Converts other human players into AI bots (NationExecution) and binds the chosen player
 * to the local clientID.
 */

import { GameMapLoader } from "@openfront/engine-api/game/GameMapLoader";
import {
  Difficulty,
  GameType,
  PlayerID,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { ClientID } from "@openfront/engine-api/Schemas";
import { Player } from "@openfront/engine/game/Game";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { decompressGameRecord, generateID } from "@openfront/shared/SharedUtil";
import { GameRecord, WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { wireGameStartInfo } from "./ReplayProcessor";

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
  gameStartInfo: WireGameStartInfo;
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
    (gu: GameUpdateViewData | ErrorUpdate) => {
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
    game.players().find((p: Player) => p.name() === opts.chosenPlayerID) ??
    null;
  if (!chosenPlayer) {
    throw new Error(`Player with ID ${opts.chosenPlayerID} not found`);
  }

  const originalClientID = chosenPlayer.clientID();

  // Take over the chosen player as the local human
  game.takeoverPlayer(chosenPlayer, opts.localClientID);

  // Convert other players to Nation bots
  for (const p of game.allPlayers()) {
    if (p.id() === chosenPlayer.id()) continue;
    if (!game.inSpawnPhase() && !p.isAlive()) continue;

    if (p.type() === PlayerType.Human) {
      game.convertHumanToNation(p, gameStart.gameID);
    }
  }

  // Update game configuration
  game.applySingleplayerConfig(opts.difficulty);

  const snapshot = runner.snapshot();

  const originalCosmetics =
    (originalClientID !== null
      ? gameStart.players.find((p) => p.clientID === originalClientID)
          ?.cosmetics
      : undefined) ?? {};

  const newGameID = generateID();
  const singlePlayerGameStart: WireGameStartInfo = {
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
