/**
 * Streaming replay encoder. Feed it one GameUpdateViewData per tick, in
 * order, from GameRunner's callback, then call end().
 *
 * Frames are encoded as soon as they arrive, because the normalized state
 * they point at is only valid for that tick. Every `keyframeInterval`
 * frames the current chunk is closed and gzipped, so peak memory is one raw
 * chunk plus the compressed ones.
 *
 * takeAppend() returns what was added since the last call. A ReplayReader
 * made from `base` with every append (see ReplayReader.append) holds the
 * whole game, which is how the viewer plays a game while it's still being
 * processed (src/client/replay/LocalProcessing.ts).
 */

import type { GameUpdateViewData } from "../../../../core/game/GameUpdates";
import type { PlayerStatic } from "../../../render/types";
import { BinaryWriter } from "../BinaryWriter";
import type { EncodeCtx } from "../EntitySchema";
import { FrameNormalizer } from "../FrameNormalizer";
import {
  DEFAULT_KEYFRAME_INTERVAL,
  EVENT_LISTS,
  type EncodedChunk,
  type GzipFn,
  type ReplayAppend,
  type ReplayBase,
  type ReplayEvents,
} from "../ReplayTypes";
import { EventCollector } from "./EventCollector";
import { FrameEncoder } from "./FrameEncoder";

export interface EncoderOptions {
  mapWidth: number;
  mapHeight: number;
  /**
   * The map's terrain bytes (GameMap.terrainByte, row-major) before the
   * first tick; terrain changes are recorded against it.
   */
  terrain: Uint8Array;
  gzip: GzipFn;
  keyframeInterval?: number;
  gameStartInfo: unknown;
  /** The map's land tiles before the first tick. */
  numLandTiles: number;
}

export class StreamingEncoder {
  /** The header fields that don't change as frames are added. */
  readonly base: ReplayBase;
  private readonly normalizer = new FrameNormalizer();
  private readonly events = new EventCollector();
  private readonly frames: FrameEncoder;
  private readonly unitTypes: string[] = [];
  private readonly unitTypeIndex = new Map<string, number>();
  private readonly ctx: EncodeCtx;

  /** Player dictionary, in first-seen order. */
  readonly players: PlayerStatic[] = [];

  private chunk: BinaryWriter | null = null;
  private chunkFrameOffsets: number[] = [];
  private chunks: EncodedChunk[] = [];
  private pending: Promise<void>[] = [];
  private totalFrames = 0;
  /** Frames up to the end of each closed chunk. */
  private chunkEnds: number[] = [];
  /** How much of each list takeAppend() has handed out. */
  private sent = {
    chunks: 0,
    players: 0,
    unitTypes: 0,
    events: Object.fromEntries(EVENT_LISTS.map((k) => [k, 0])) as Record<
      (typeof EVENT_LISTS)[number],
      number
    >,
  };

  constructor(private readonly opts: EncoderOptions) {
    this.base = {
      keyframeInterval: opts.keyframeInterval ?? DEFAULT_KEYFRAME_INTERVAL,
      mapWidth: opts.mapWidth,
      mapHeight: opts.mapHeight,
      numLandTiles: opts.numLandTiles,
      gameStartInfo: opts.gameStartInfo,
    };
    this.frames = new FrameEncoder(opts.mapWidth, opts.mapHeight, opts.terrain);
    this.ctx = {
      unitTypeIndex: (t) => {
        let i = this.unitTypeIndex.get(t);
        if (i === undefined) {
          i = this.unitTypes.length;
          // The dictionary count is a u8.
          if (i >= 255) throw new Error("more than 255 unit types");
          this.unitTypes.push(t);
          this.unitTypeIndex.set(t, i);
        }
        return i;
      },
    };
  }

  get frameCount(): number {
    return this.totalFrames;
  }

  pushFrame(gu: GameUpdateViewData): void {
    const frame = this.normalizer.push(gu);
    this.players.push(...frame.newPlayers);

    if (this.chunk === null) {
      this.chunk = new BinaryWriter(4 * 1024 * 1024);
      this.chunkFrameOffsets = [];
    }
    this.chunkFrameOffsets.push(this.chunk.offset);
    if (this.chunkFrameOffsets.length === 1) {
      this.frames.encodeKeyframe(this.chunk, frame, this.ctx);
    } else {
      this.frames.encodeDelta(this.chunk, frame, this.ctx);
    }
    this.totalFrames++;
    // After encoding, so the terrain has this tick's changes.
    this.events.push(frame, (ref) => this.frames.isLand(ref));

    if (this.chunkFrameOffsets.length >= this.base.keyframeInterval) {
      this.closeChunk();
    }
  }

  /**
   * Frames in the closed chunks that end by `limit`, the most takeAppend()
   * can hand out with it. The open chunk isn't included (until end()), so
   * the live edge lags by up to one chunk, but a chunk never changes once
   * it has been handed out.
   */
  completeFrames(limit = Infinity): number {
    let frames = 0;
    for (let i = this.chunkEnds.length - 1; i >= 0; i--) {
      if (this.chunkEnds[i] <= limit) {
        frames = this.chunkEnds[i];
        break;
      }
    }
    return frames;
  }

  /** Close the last chunk. Call after the last frame. */
  end(): void {
    this.closeChunk();
  }

  /**
   * What was added since the last call: the closed chunks that end by
   * `limit` frames, and the players, unit types and events so far.
   *
   * The contents are picked before the first await. The caller's game loop
   * can keep going while the gzips finish, and reading `this` after the
   * await could pick up more of the game. Events can run past the last
   * chunk handed out, which is harmless since no frame reaches them.
   */
  async takeAppend(limit = Infinity): Promise<ReplayAppend> {
    const events = {
      spawnPhaseEnd: this.events.spawnPhaseEnd,
    } as ReplayEvents;
    for (const key of EVENT_LISTS) {
      const list = this.events[key];
      (events[key] as unknown[]) = list.slice(this.sent.events[key]);
      this.sent.events[key] = list.length;
    }
    let chunks = this.sent.chunks;
    while (chunks < this.chunkEnds.length && this.chunkEnds[chunks] <= limit) {
      chunks++;
    }
    const more: ReplayAppend = {
      chunks: this.chunks.slice(this.sent.chunks, chunks),
      players: this.players.slice(this.sent.players),
      unitTypes: this.unitTypes.slice(this.sent.unitTypes),
      events,
    };
    this.sent.chunks = chunks;
    this.sent.players = this.players.length;
    this.sent.unitTypes = this.unitTypes.length;
    // closeChunk's gzips fill the chunks in place.
    await this.gzipped();
    return more;
  }

  /** Wait for every chunk gzip started so far. */
  private async gzipped(): Promise<void> {
    const pending = this.pending;
    this.pending = [];
    await Promise.all(pending);
  }

  /**
   * Chunk layout: u16 frameCount, u32 × frameCount frame offsets (relative
   * to the end of the offset table), then the frames.
   */
  private closeChunk(): void {
    if (this.chunk === null) return;
    const body = this.chunk.finish();
    const offsets = this.chunkFrameOffsets;
    const out = new BinaryWriter(2 + offsets.length * 4 + body.length);
    out.writeU16(offsets.length);
    for (const o of offsets) out.writeU32(o);
    out.writeBytes(body);
    this.chunk = null;

    // Filled in place rather than replaced: takeAppend() copies the list
    // before awaiting the gzips and would otherwise end up with empty
    // chunks.
    const slot: EncodedChunk = {
      compressed: new Uint8Array(0),
      frameCount: offsets.length,
    };
    this.chunks.push(slot);
    this.chunkEnds.push(this.totalFrames);
    const result = this.opts.gzip(out.finish());
    if (result instanceof Promise) {
      this.pending.push(
        result.then((compressed) => {
          slot.compressed = compressed;
        }),
      );
    } else {
      slot.compressed = result;
    }
  }
}
