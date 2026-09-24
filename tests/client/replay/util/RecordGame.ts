/**
 * Test fixture: runs a real core game through GameRunner, streams every
 * tick into a StreamingEncoder, and records ground truth read straight from
 * the live Game objects at the same tick - independent of the wire stream
 * the encoder consumes, so a normalization bug can't hide itself.
 */

import { gunzipSync, gzipSync } from "zlib";
import { ReplayReader } from "../../../../src/client/replay/codec/decode/ReplayReader";
import { StreamingEncoder } from "../../../../src/client/replay/codec/encode/StreamingEncoder";
import {
  EVENT_LISTS,
  type ReplayAppend,
  type ReplayBase,
  type ReplayData,
} from "../../../../src/client/replay/codec/ReplayTypes";
import { terrainOf } from "../../../../src/client/replay/codec/Terrain";
import { Executor } from "../../../../src/core/execution/ExecutionManager";
import { Game } from "../../../../src/core/game/Game";
import { GameUpdateViewData } from "../../../../src/core/game/GameUpdates";
import { GameRunner } from "../../../../src/core/GameRunner";

export const gzip = (d: Uint8Array) => new Uint8Array(gzipSync(d));
/** Synchronous, so a reader decodes without load() (see ReplayReader). */
export const inflate = (d: Uint8Array) => new Uint8Array(gunzipSync(d));

/** Appends in order, as one (what ReplayReader.data makes). */
export function mergeAppends(appends: readonly ReplayAppend[]): ReplayAppend {
  const out: ReplayAppend = {
    chunks: [],
    players: [],
    unitTypes: [],
    events: {
      nukeImpacts: [],
      railroadEvents: [],
      motionPlans: [],
      constructionStarts: [],
      deadUnitEvents: [],
      spawnPhaseEnd: null,
    },
  };
  for (const a of appends) {
    out.chunks.push(...a.chunks);
    out.players.push(...a.players);
    out.unitTypes.push(...a.unitTypes);
    for (const key of EVENT_LISTS) {
      (out.events[key] as unknown[]).push(...a.events[key]);
    }
    out.events.spawnPhaseEnd ??= a.events.spawnPhaseEnd;
  }
  return out;
}

/** A reader holding a whole replay, decoding synchronously. */
export function openReader(replay: ReplayData): ReplayReader {
  const reader = new ReplayReader(replay.base, inflate);
  reader.append(replay.append);
  return reader;
}

/** Everything an encoder has, after its last frame. */
export async function finish(
  encoder: StreamingEncoder,
  taken: readonly ReplayAppend[] = [],
): Promise<ReplayData> {
  encoder.end();
  const rest = await encoder.takeAppend();
  return { base: encoder.base, append: mergeAppends([...taken, rest]) };
}

export interface PlayerTruth {
  tilesOwned: number;
  gold: number;
  troops: number;
  goldEarned: number;
  isAlive: boolean;
  isTraitor: boolean;
  betrayals: number;
  allies: number[];
}

export interface UnitTruth {
  unitType: string;
  ownerID: number;
  pos: number;
  troops: number;
  level: number;
}

export interface TickTruth {
  tick: number;
  players: Map<number, PlayerTruth>;
  units: Map<number, UnitTruth>;
  /** Null on ticks where tile truth wasn't sampled (see tileTruthEvery). */
  tileState: Uint16Array | null;
}

export interface RecordedGame {
  /** The whole replay. */
  replay: ReplayData;
  truth: TickTruth[];
  frames: GameUpdateViewData[];
  base: ReplayBase;
  /** The first append, taken mid-game when splitAfter was given. */
  first?: ReplayAppend;
  /** Everything after `first`, as the processor's last append. */
  rest?: ReplayAppend;
}

export interface RecordOptions {
  ticks: number;
  keyframeInterval?: number;
  /** Called before each tick executes; use it to add scripted executions. */
  beforeTick?: (game: Game, tick: number) => void;
  /** Skip GameRunner.init() (spawn timers, bots, win checks). */
  skipInit?: boolean;
  /** Capture full-map tile truth every N ticks (default 1). */
  tileTruthEvery?: number;
  /**
   * Store each frame as a structured clone, as the worker delivers it to
   * the main thread. In process, GameRunner hands every tick the same
   * playerNameViewData object and keeps mutating it, so a raw frame read
   * after later ticks shows later placements. Needed by anything that
   * replays `frames` after recording (default: raw, as encoded).
   */
  cloneFrames?: boolean;
  /** Take the first append once this many ticks have been pushed. */
  splitAfter?: number;
}

export async function recordGame(
  game: Game,
  opts: RecordOptions,
): Promise<RecordedGame> {
  const encoder = new StreamingEncoder({
    mapWidth: game.width(),
    mapHeight: game.height(),
    terrain: terrainOf(game.map()),
    gzip,
    keyframeInterval: opts.keyframeInterval ?? 10,
    gameStartInfo: { test: true },
    numLandTiles: game.numLandTiles(),
  });
  const truth: TickTruth[] = [];
  const frames: GameUpdateViewData[] = [];
  let error: string | undefined;
  let first: Promise<ReplayAppend> | undefined;

  const runner = new GameRunner(
    game,
    new Executor(game, "game_id", undefined),
    (gu) => {
      if ("errMsg" in gu) {
        error = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      frames.push(opts.cloneFrames ? structuredClone(gu) : gu);
      encoder.pushFrame(gu);
      if (frames.length === opts.splitAfter) first = encoder.takeAppend();
      const withTiles = truth.length % (opts.tileTruthEvery ?? 1) === 0;
      truth.push(captureTruth(game, gu.tick, withTiles));
    },
  );
  if (!opts.skipInit) runner.init();

  for (let t = 0; t < opts.ticks; t++) {
    opts.beforeTick?.(game, t);
    runner.addTurn({ turnNumber: t, intents: [] });
    runner.executeNextTick();
    if (error !== undefined) throw new Error(`tick ${t} failed: ${error}`);
  }

  const firstAppend = await first;
  encoder.end();
  const rest = await encoder.takeAppend();
  const replay: ReplayData = {
    base: encoder.base,
    append: mergeAppends(
      firstAppend === undefined ? [rest] : [firstAppend, rest],
    ),
  };
  return {
    replay,
    truth,
    frames,
    base: encoder.base,
    first: firstAppend,
    rest: firstAppend === undefined ? undefined : rest,
  };
}

export function captureTruth(
  game: Game,
  tick: number,
  withTiles: boolean,
): TickTruth {
  const players = new Map<number, PlayerTruth>();
  for (const p of game.allPlayers()) {
    players.set(p.smallID(), {
      tilesOwned: p.numTilesOwned(),
      gold: Number(p.gold()),
      troops: p.troops(),
      goldEarned: Number(p.goldEarned()),
      isAlive: p.isAlive(),
      isTraitor: p.isTraitor(),
      betrayals: p.betrayals(),
      allies: p.allies().map((a) => a.smallID()),
    });
  }
  const units = new Map<number, UnitTruth>();
  for (const u of game.units()) {
    if (!u.isActive()) continue;
    units.set(u.id(), {
      unitType: u.type(),
      ownerID: u.owner().smallID(),
      pos: u.tile(),
      troops: u.troops(),
      level: u.level(),
    });
  }
  let tileState: Uint16Array | null = null;
  if (withTiles) {
    const map = game.map();
    tileState = new Uint16Array(map.width() * map.height());
    for (let ref = 0; ref < tileState.length; ref++) {
      tileState[ref] = map.tileState(ref) & 0xffff;
    }
  }
  return { tick, players, units, tileState };
}
