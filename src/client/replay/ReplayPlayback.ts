/**
 * Replay playback. Turns a replay into FrameData for the renderer, with
 * play, pause, speed and seek. No DOM code in here.
 *
 * The decoder is synchronous but browsers can only gunzip asynchronously,
 * so each step loads its chunk first, and the next chunk is inflated ahead
 * of time. Moving forward by up to STEP_LIMIT frames plays through them
 * one by one so trails and FX stay right, anything else is a seek.
 * Requests don't queue up, only the latest target matters, so dragging the
 * timeline doesn't fall behind.
 *
 * A game that's still being processed opens from its base and first
 * append, and append() adds new frames as they come. When `live` is set,
 * reaching the last frame waits for more (like a video buffering) instead
 * of stopping.
 */

import type { FrameData } from "../render/types";
import { ReplayReader } from "./codec/decode/ReplayReader";
import type {
  InflateFn,
  ReplayAppend,
  ReplayData,
  ReplayFrame,
  ReplayHeader,
} from "./codec/ReplayTypes";
import { ReplayFrameBuilder, type ReplayRules } from "./ReplayFrameBuilder";

/** Game ticks per second at 1x (Config turnIntervalMs = 100). */
export const TICKS_PER_SECOND = 10;
/** Forward jumps up to this many frames play through instead of seeking. */
export const STEP_LIMIT = 30;

/** `source` is the decoded frame, since FrameData has no terrain changes. */
export type FrameSink = (
  frame: FrameData,
  seeked: boolean,
  source: ReplayFrame,
) => void;

export class ReplayPlayback {
  onFrame: FrameSink | null = null;
  /** Called when playing, paused or the position changes. */
  onChange: (() => void) | null = null;
  /**
   * `inReplay`: the replay itself failed to decode or build. False when
   * onFrame threw (the renderer), which says nothing about the replay.
   */
  onError: ((err: unknown, inReplay: boolean) => void) | null = null;
  /** More frames are still coming (see append()). */
  live = false;

  private current = -1;
  private target = 0;
  private _playing = false;
  private _speed = 1;
  private lastNow: number | null = null;
  private carry = 0;
  private pumping: Promise<void> | null = null;
  /** Set after a decode error. Playback stays stopped. */
  private failed = false;

  private constructor(
    private readonly reader: ReplayReader,
    private readonly builder: ReplayFrameBuilder,
  ) {}

  /**
   * `source`: a stored replay, or a game still being processed (its base
   * and first append).
   */
  static async open(
    source: ReplayData,
    gunzip: InflateFn,
    rules: ReplayRules,
  ): Promise<ReplayPlayback> {
    const reader = new ReplayReader(source.base, gunzip);
    reader.append(source.append);
    // Decode the first frame too, so a replay that won't play fails here,
    // before the viewer sets anything up for it.
    await reader.load(0);
    reader.seek(0);
    const builder = new ReplayFrameBuilder(reader.header, rules);
    return new ReplayPlayback(reader, builder);
  }

  /** The whole replay so far, to keep it (ReplayStore). */
  data(): ReplayData {
    return this.reader.data();
  }

  /**
   * Adds frames from a game that's still being processed. It only adds
   * past the end, so it's safe to call at any time, even mid-decode.
   */
  append(more: ReplayAppend): void {
    this.reader.append(more);
    this.builder.append(more);
    this.onChange?.();
  }

  /** So the viewer can pass cosmetics and settings to the frame builder. */
  get frameBuilder(): ReplayFrameBuilder {
    return this.builder;
  }

  get header(): ReplayHeader {
    return this.reader.header;
  }

  get totalFrames(): number {
    return this.reader.header.totalFrames;
  }

  /** The last frame delivered (-1 before the first). */
  get frame(): number {
    return this.current;
  }

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  setSpeed(speed: number): void {
    this._speed = speed;
    this.onChange?.();
  }

  play(): void {
    if (this._playing) return;
    // At the end of a finished replay, play starts over. At the live edge
    // it waits for more.
    if (!this.live && this.target >= this.totalFrames - 1) this.target = 0;
    this._playing = true;
    this.lastNow = null;
    this.carry = 0;
    this.onChange?.();
    void this.settle();
  }

  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    this.onChange?.();
  }

  /** Go to a frame. Resolves once the latest requested frame is shown. */
  seek(frame: number): Promise<void> {
    this.target = Math.max(0, Math.min(this.totalFrames - 1, frame));
    this.carry = 0;
    return this.settle();
  }

  /** Deliver the current frame again as a seek (after a GL context restore). */
  refresh(): Promise<void> {
    if (this.current < 0) return this.settle();
    this.target = this.current;
    this.current = -1;
    return this.settle();
  }

  /** Called from the animation loop with the current time in ms. */
  tick(nowMs: number): void {
    if (!this._playing) return;
    if (this.lastNow === null) {
      this.lastNow = nowMs;
      return;
    }
    // Cap long gaps (hidden tab) so they don't turn into a huge jump.
    const elapsed = Math.min(nowMs - this.lastNow, 1000);
    this.lastNow = nowMs;
    this.carry += (elapsed / 1000) * TICKS_PER_SECOND * this._speed;
    const frames = Math.floor(this.carry);
    if (frames === 0) return;
    this.carry -= frames;
    // Never more than STEP_LIMIT frames past the one on screen, so playing
    // steps instead of seeking. A device that can't keep up at this speed
    // plays slower: seeking every frame would cost more and fall further
    // behind. A pending seek's target is left where it is.
    const wanted = this.target + frames;
    const next = Math.min(wanted, Math.max(this.current, 0) + STEP_LIMIT);
    if (next < wanted) this.carry = 0;
    this.target = Math.min(this.totalFrames - 1, Math.max(this.target, next));
    if (this.target === this.totalFrames - 1) {
      // Don't build up time while waiting at the live edge.
      if (this.live) this.carry = 0;
      else this.pause();
    }
    void this.settle();
  }

  /** Resolves once the latest target is shown, or decoding failed. */
  private async settle(): Promise<void> {
    // The target can move while a drain finishes, so loop until it's reached.
    while (this.current !== this.target && !this.failed) {
      this.pumping ??= this.drain().finally(() => {
        this.pumping = null;
      });
      await this.pumping;
    }
  }

  /** Deliver frames until the target is reached. */
  private async drain(): Promise<void> {
    let inReplay = true;
    try {
      while (this.current !== this.target) {
        const target = this.target;
        const stepping =
          this.current >= 0 &&
          target > this.current &&
          target - this.current <= STEP_LIMIT;
        const frame = stepping ? this.current + 1 : target;
        await this.reader.load(this.reader.chunkOf(frame));
        // The target may have moved while the chunk loaded. That's fine:
        // this step still lands where it was going, and the loop goes on.
        const f = stepping ? this.reader.next()! : this.reader.seek(target);
        const fd = stepping ? this.builder.advance(f) : this.builder.seek(f);
        this.current = f.frame;
        inReplay = false;
        this.onFrame?.(fd, !stepping, f);
        inReplay = true;
        this.prefetchNextChunk();
        this.onChange?.();
      }
    } catch (err) {
      this.fail(err, inReplay);
    }
  }

  /** Stop for good after an error. Reported once. */
  private fail(err: unknown, inReplay: boolean): void {
    if (this.failed) return;
    this.failed = true;
    this._playing = false;
    this.onError?.(err, inReplay);
  }

  private prefetchNextChunk(): void {
    const next = this.reader.chunkOf(this.current) + 1;
    this.reader.load(next).catch((err: unknown) => this.fail(err, true));
  }
}
