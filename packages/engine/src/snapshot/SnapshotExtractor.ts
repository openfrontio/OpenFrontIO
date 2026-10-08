/**
 * Extracts a playable singleplayer game snapshot from game start info and turns at a given tick.
 * Converts other human players into AI bots (NationExecution) and binds the chosen player
 * to the local clientID.
 */

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
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { ClientID, GameStartInfo, Turn } from "@openfront/engine-api/Schemas";
import { Player } from "../game/Game";
import { createGameRunner } from "../GameRunner";

export interface ExtractSnapshotOptions {
  gameStartInfo: GameStartInfo;
  turns: Turn[];
  mapFiles: MapFiles;
  targetTick: number;
  chosenPlayerID: PlayerID;
  localClientID: ClientID;
  difficulty?: Difficulty;
  newGameID?: string;
}

export interface ExtractedSnapshotResult {
  snapshot: Uint8Array;
  gameStartInfo: GameStartInfo;
}

/**
 * Re-runs turns headless up to targetTick, configures the chosen player
 * as the local human player and converts all other players to AI bots, then captures
 * a snapshot ready for singleplayer game resumption.
 */
export async function extractSnapshot(
  opts: ExtractSnapshotOptions,
): Promise<ExtractedSnapshotResult> {
  const gameStart = opts.gameStartInfo;
  let tickError: string | undefined;

  const runner = await createGameRunner(
    gameStart,
    undefined,
    opts.mapFiles,
    (gu: GameUpdateViewData | ErrorUpdate) => {
      if ("errMsg" in gu) {
        tickError = `${gu.errMsg}\n${gu.stack ?? ""}`;
      }
    },
  );

  const game = runner.game;
  const target = Math.max(0, opts.targetTick);

  for (let i = 0; i < opts.turns.length; i++) {
    const turn = opts.turns[i];
    if (turn.turnNumber >= target) break;
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

  const originalPlayer =
    originalClientID !== null
      ? gameStart.players.find((p) => p.clientID === originalClientID)
      : undefined;

  const singlePlayerGameStart: GameStartInfo = {
    ...gameStart,
    gameID: opts.newGameID ?? gameStart.gameID,
    players: [
      {
        ...(originalPlayer ?? {}),
        clientID: opts.localClientID,
        username: chosenPlayer.name(),
        clanTag: chosenPlayer.clanTag(),
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
