/**
 * Test fixture: plays a game the way a live match runs and archives it the
 * way the game server does, producing a real GameRecord without the network.
 *
 * "Live" here means a client's pipeline: the server sends the wire-blanked
 * GameStartInfo (toWireGameStartInfo) and each client runs createGameRunner
 * with its own clientID. Every turn carries the intents the scenario sends;
 * the recorded hash for a turn is the one the client computed (the server
 * stores the hash its clients agreed on). The record is built with the
 * server's own createPartialGameRecord, then JSON round-tripped and parsed
 * with GameRecordSchema, as the archive API serves it.
 */

import path from "path";
import { fileURLToPath } from "url";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../../src/core/game/Game";
import {
  GameUpdateType,
  HashUpdate,
} from "../../../../src/core/game/GameUpdates";
import { createGameRunner } from "../../../../src/core/GameRunner";
import {
  GameConfig,
  GameRecord,
  GameRecordSchema,
  GameStartInfo,
  Player,
  PlayerRecord,
  StampedIntent,
  Turn,
} from "../../../../src/core/Schemas";
import {
  createPartialGameRecord,
  toWireGameStartInfo,
} from "../../../../src/core/Util";
import { NodeGameMapLoader } from "../../../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export const mapLoader = new NodeGameMapLoader(
  path.join(PROJECT_ROOT, "resources/maps"),
);

export interface ArchiveOptions {
  gameID: string;
  config: GameConfig;
  players: Player[];
  ticks: number;
  tribes?: GameStartInfo["tribes"];
  /** Intents the clients send for turn `tick`, given the live game. */
  intents?: (game: Game, tick: number) => StampedIntent[];
}

export interface ArchivedGame {
  record: GameRecord;
  /** What the live clients received. */
  wireStart: GameStartInfo;
}

export async function playAndArchive(
  opts: ArchiveOptions,
): Promise<ArchivedGame> {
  const start: GameStartInfo = {
    gameID: opts.gameID,
    lobbyCreatedAt: 1_700_000_000_000,
    config: opts.config,
    players: opts.players,
    ...(opts.tribes !== undefined ? { tribes: opts.tribes } : {}),
  };
  const wireStart = toWireGameStartInfo(start);

  const hashes = new Map<number, number>();
  let error: string | undefined;
  const runner = await createGameRunner(
    wireStart,
    opts.players[0]?.clientID,
    mapLoader,
    (gu) => {
      if ("errMsg" in gu) {
        error = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      for (const hu of gu.updates[GameUpdateType.Hash] as HashUpdate[]) {
        hashes.set(hu.tick, hu.hash);
      }
    },
  );

  const turns: Turn[] = [];
  for (let t = 0; t < opts.ticks; t++) {
    const turn: Turn = {
      turnNumber: t,
      intents: opts.intents?.(runner.game, t) ?? [],
    };
    runner.addTurn(turn);
    if (!runner.executeNextTick() || error !== undefined) {
      throw new Error(`live game failed at turn ${t}: ${error}`);
    }
    const hash = hashes.get(t);
    turns.push(hash !== undefined ? { ...turn, hash } : turn);
  }

  const playerRecords: PlayerRecord[] = opts.players.map((p) => ({
    ...p,
    persistentID: null,
    stats: {},
  }));
  const partial = createPartialGameRecord(
    start.gameID,
    start.config,
    playerRecords,
    turns,
    start.lobbyCreatedAt,
    start.lobbyCreatedAt + opts.ticks * 100,
    undefined,
    start.lobbyCreatedAt,
    undefined,
    start.tribes,
  );
  const record = GameRecordSchema.parse(
    JSON.parse(JSON.stringify({ ...partial, gitCommit: "DEV" })),
  );
  return { record, wireStart };
}

/** A spawn intent for `clientID` on the first unowned land tile at/after `from`. */
export function spawnOnLand(
  game: Game,
  clientID: string,
  from: number,
): StampedIntent {
  const map = game.map();
  for (let ref = from; ref < map.width() * map.height(); ref++) {
    if (map.isLand(ref) && !map.hasOwner(ref)) {
      return { type: "spawn", clientID, tile: ref };
    }
  }
  throw new Error("no free land tile");
}

/** A public-game config; Pangaea FFA with 20 bots unless overridden. */
export function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameMap: GameMapType.Pangaea,
    difficulty: Difficulty.Medium,
    donateGold: false,
    donateTroops: false,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    gameMapSize: GameMapSize.Normal,
    nations: "default",
    bots: 20,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    disabledUnits: [],
    ...overrides,
  };
}

export function human(n: number, overrides: Partial<Player> = {}): Player {
  return {
    clientID: `client00${n}`,
    username: `Human ${n}`,
    clanTag: null,
    ...overrides,
  };
}
