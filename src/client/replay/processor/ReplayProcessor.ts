/**
 * Replay processor: re-runs an archived game record with the core and
 * feeds every tick to the replay encoder. The replay comes out through
 * onStart and onAppend.
 *
 * The game is set up the same way a client watching the record sets it up
 * (Main.ts, LocalServer, Worker). The server's wire blanking is applied to
 * the record's GameStartInfo again (toWireGameStartInfo). Clan tags and
 * friends feed into team assignment, so skipping that desyncs team games.
 * The game is built by createGameRunner with no local clientID, and the
 * turns are executed in order.
 *
 * Every hash the server recorded (agreed on by the live clients) is checked
 * as the game runs. The core is only deterministic within one build, so a
 * record from another commit drifts at some point, and everything after
 * that would be a different game. The first mismatch stops processing.
 * Hashes only come every few turns, so frames are handed out (onAppend)
 * once a later hash has matched: whatever the viewer holds when a mismatch
 * turns up is the game that was played.
 */

import { Game } from "../../../core/game/Game";
import { GameMapLoader } from "../../../core/game/GameMapLoader";
import {
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
} from "../../../core/game/GameUpdates";
import { createGameRunner } from "../../../core/GameRunner";
import {
  GameRecord,
  GameStartInfo,
  GameStartInfoSchema,
} from "../../../core/Schemas";
import { decompressGameRecord, toWireGameStartInfo } from "../../../core/Util";
import { StreamingEncoder } from "../codec/encode/StreamingEncoder";
import type { GzipFn, ReplayAppend, ReplayBase } from "../codec/ReplayTypes";
import { terrainOf } from "../codec/Terrain";

export interface ProcessProgress {
  tick: number;
  totalTicks: number;
  percent: number;
}

export interface ProcessOptions {
  mapLoader: GameMapLoader;
  gzip: GzipFn;
  keyframeInterval?: number;
  /** Called every PROGRESS_EVERY ticks and after the last one. */
  onProgress?: (progress: ProcessProgress) => void;
  /**
   * Called once, before the first tick, with the header fields that don't
   * change. With every onAppend after it, that's the whole replay (see
   * ReplayReader).
   */
  onStart?: (base: ReplayBase) => void;
  /**
   * Called during processing so the game can be watched as it goes, with
   * what was added since the last call. Every frame in it has been checked
   * against a recorded hash, or comes after the record's last one. The last
   * call comes after the final tick. `frames` is the total so far. The
   * simulation waits for the returned promise.
   */
  onAppend?: (append: ReplayAppend, frames: number) => Promise<void> | void;
  /**
   * Milliseconds between onAppend calls (default 5000). The first call
   * comes as soon as one chunk is done, so the viewer has frames after
   * about a second.
   */
  appendEveryMs?: number;
  /** Called after each tick with the live game. Used by tests. */
  onTick?: (game: Game, frame: GameUpdateViewData) => void;
}

export interface HashMismatch {
  turn: number;
  recorded: number;
  computed: number | null;
}

export interface ProcessResult {
  totalTicks: number;
}

const PROGRESS_EVERY = 100;

export class ReplayDesyncError extends Error {
  constructor(readonly mismatch: HashMismatch) {
    super(
      `re-simulation diverged from the recorded game at turn ` +
        `${mismatch.turn} (recorded hash ${mismatch.recorded}, computed ` +
        `${mismatch.computed ?? "none"}), the record was probably played on ` +
        `a different build`,
    );
    this.name = "ReplayDesyncError";
  }
}

/**
 * The GameStartInfo the live clients got for this game. The schema drops
 * the record-only fields (player stats and persistentID stay out, since
 * this goes into the replay header), then the server's wire blanking is
 * applied.
 */
export function wireGameStartInfo(record: GameRecord): GameStartInfo {
  return toWireGameStartInfo(GameStartInfoSchema.parse(record.info));
}

export async function processGameRecord(
  record: GameRecord,
  opts: ProcessOptions,
): Promise<ProcessResult> {
  // decompressGameRecord replaces the record's turns, so give it a copy.
  const { turns } = decompressGameRecord({ ...record });
  const gameStart = wireGameStartInfo(record);

  const recordedHashes = new Map<number, number>();
  // Frames after the record's last hash can't be checked, so they don't
  // wait for one.
  let lastHashedIndex = -1;
  turns.forEach((turn, i) => {
    if (turn.hash !== null && turn.hash !== undefined) {
      recordedHashes.set(turn.turnNumber, turn.hash);
      lastHashedIndex = i;
    }
  });
  // Checked as each tick's hash comes out. A turn with a recorded hash but
  // none computed is a mismatch too (checked after the tick).
  let mismatch: HashMismatch | null = null;
  let hashedTurn = -1;
  let tickError: string | undefined;

  // The callback only runs from executeNextTick, by which point `encoder`
  // and `game` below are set.
  const runner = await createGameRunner(
    gameStart,
    undefined,
    opts.mapLoader,
    (gu) => {
      if ("errMsg" in gu) {
        tickError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      for (const hu of gu.updates[GameUpdateType.Hash] as HashUpdate[]) {
        hashedTurn = hu.tick;
        const recorded = recordedHashes.get(hu.tick);
        if (recorded !== undefined && recorded !== hu.hash) {
          mismatch ??= { turn: hu.tick, recorded, computed: hu.hash };
        }
      }
      encoder.pushFrame(gu);
      opts.onTick?.(game, gu);
    },
  );
  const game = runner.game;
  const encoder = new StreamingEncoder({
    mapWidth: game.width(),
    mapHeight: game.height(),
    terrain: terrainOf(game.map()),
    gzip: opts.gzip,
    keyframeInterval: opts.keyframeInterval,
    gameStartInfo: gameStart,
    // Water nukes shrink the land count during the game. The header stores
    // the map's original count.
    numLandTiles: game.numLandTiles(),
  });
  opts.onStart?.(encoder.base);

  const appendEvery = opts.appendEveryMs ?? 5000;
  let lastAppend = performance.now();
  let appendedFrames = 0;
  /** Frames up to here (one per turn) are checked. */
  let checkedFrames = 0;
  /** Hand out the closed chunks that are checked and not sent yet. */
  const appendChecked = async () => {
    const frames = encoder.completeFrames(checkedFrames);
    if (opts.onAppend === undefined || frames <= appendedFrames) return;
    appendedFrames = frames;
    await opts.onAppend(await encoder.takeAppend(frames), frames);
    lastAppend = performance.now();
  };
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    runner.addTurn(turn);
    if (!runner.executeNextTick() || tickError !== undefined) {
      throw new Error(
        `simulation failed at turn ${turn.turnNumber}: ` +
          (tickError ?? "tick did not execute"),
      );
    }

    const recorded = recordedHashes.get(turn.turnNumber);
    if (recorded !== undefined && hashedTurn !== turn.turnNumber) {
      mismatch ??= { turn: turn.turnNumber, recorded, computed: null };
    }
    if (mismatch !== null) {
      // What was checked before this turn is the game that was played, so
      // it's handed out even if the next append wasn't due yet.
      await appendChecked();
      throw new ReplayDesyncError(mismatch);
    }
    if (recorded !== undefined || i >= lastHashedIndex) checkedFrames = i + 1;

    if (
      opts.onProgress &&
      ((i + 1) % PROGRESS_EVERY === 0 || i === turns.length - 1)
    ) {
      opts.onProgress({
        tick: i + 1,
        totalTicks: turns.length,
        percent: Math.floor(((i + 1) / turns.length) * 100),
      });
    }

    if (appendedFrames === 0 || performance.now() - lastAppend >= appendEvery) {
      await appendChecked();
    }
  }

  encoder.end();
  if (opts.onAppend !== undefined) {
    await opts.onAppend(await encoder.takeAppend(), encoder.frameCount);
  }
  return { totalTicks: encoder.frameCount };
}
