// What the leaderboard table keeps from one refresh to the next.

import { TICKS_PER_SECOND } from "../hud/GameTicks";
import type { GameView } from "../view";

/** Whether a row climbed or fell over the last 30 seconds. */
export type Trend = "up" | "down";

// A row is marked when its rank moved over this window and stayed moved
// for the last few seconds of play. Early ranks change all the time, so
// nothing is marked in the spawn phase or the minute after it.
const TREND_WINDOW_TICKS = 30 * TICKS_PER_SECOND;
const TREND_HELD_TICKS = 5 * TICKS_PER_SECOND;
const TREND_QUIET_TICKS = 60 * TICKS_PER_SECOND;

/**
 * Whether the list a refresh draws follows on from the last refresh's: the
 * same sort, and a clock that went on by no more than a jump. When it does
 * not (a new sort, a replay seek, a tab that slept), what the table kept of
 * the last refresh says nothing about what changed since.
 */
export class RefreshClock {
  private last: { sort: string; tick: number; speed: number } | null = null;
  private readonly jumpTicks: number;

  /** `jumpTicks`: the longest gap between two refreshes at normal speed. */
  constructor(jumpTicks: number) {
    this.jumpTicks = jumpTicks;
  }

  /**
   * Notes a refresh of the list sorted by `sort` at `tick`. A game playing
   * `speed` times faster (a replay) puts that many times more ticks between
   * two refreshes. The gap may have built up at the last refresh's speed,
   * when the viewer slows a replay in between, so the faster one counts.
   */
  next(sort: string, tick: number, speed: number): boolean {
    const last = this.last;
    this.last = { sort, tick, speed };
    return (
      last !== null &&
      last.sort === sort &&
      tick >= last.tick &&
      tick - last.tick <= this.jumpTicks * Math.max(speed, last.speed)
    );
  }

  /** The table hid, or a replay sought: the next refresh does not follow on. */
  forget() {
    this.last = null;
  }
}

/**
 * Each row's index at the last refresh, and the rows that changed place
 * since: they glide there from where they were.
 */
export class RowMoves {
  private index = new Map<string, number>();
  private moves = new Map<string, { from: number; to: number }>();

  /** Notes the rows' new order, by key from the top. */
  note(keys: readonly string[]) {
    const index = new Map<string, number>();
    this.moves = new Map();
    keys.forEach((key, to) => {
      index.set(key, to);
      const from = this.index.get(key);
      if (from !== undefined && from !== to) this.moves.set(key, { from, to });
    });
    this.index = index;
  }

  /** The moves noted at the last refresh, once. */
  take(): ReadonlyMap<string, { from: number; to: number }> {
    const moves = this.moves;
    this.moves = new Map();
    return moves;
  }

  /** Drops the moves noted: the rows move some other way this time. */
  drop() {
    this.moves = new Map();
  }

  /** The order from before means nothing for the next one. */
  forget() {
    this.index = new Map();
    this.moves = new Map();
  }
}

/**
 * Each row's rank at each refresh, back to one 30 seconds old, and the rows
 * whose rank is better, or worse, than 30 seconds ago in every refresh of
 * the last five seconds of play: a move that held, not a wobble.
 */
export class RankTrends {
  private history: { tick: number; ranks: ReadonlyMap<string, number> }[] = [];
  private trends = new Map<string, Trend>();

  /** Notes the ranks at this refresh of `game`. */
  note(ranks: ReadonlyMap<string, number>, game: GameView) {
    const tick = game.ticks();
    // The clock stood still (a pause): nothing moved.
    if (this.history[this.history.length - 1]?.tick === tick) return;
    this.history.push({ tick, ranks });
    while (
      this.history.length > 1 &&
      this.history[1].tick <= tick - TREND_WINDOW_TICKS
    ) {
      this.history.shift();
    }

    this.trends = new Map();
    const [then] = this.history;
    // Five seconds of play, not five refreshes: the list also refreshes when
    // the mouse leaves it, and in a fast replay one refresh covers more than
    // five seconds. The ranks from 30 seconds ago are older than all these.
    const recent = this.history.filter(
      (snapshot) => snapshot.tick > tick - TREND_HELD_TICKS,
    );
    // The minute is the game's, not counted from this table's first refresh:
    // a table opened late marks once it has 30 seconds of ranks, and a replay
    // sought back into the first minute of play marks nothing.
    if (
      then.tick > tick - TREND_WINDOW_TICKS ||
      game.ticksSinceStart() < TREND_QUIET_TICKS
    ) {
      return;
    }
    for (const [key, before] of then.ranks) {
      const ranks = recent.map((snapshot) => snapshot.ranks.get(key));
      if (ranks.every((rank) => rank !== undefined && rank < before)) {
        this.trends.set(key, "up");
      } else if (ranks.every((rank) => rank !== undefined && rank > before)) {
        this.trends.set(key, "down");
      }
    }
  }

  /**
   * The marks of the drawn rows `keys`, or none when more than half of them
   * would carry one: the ranks are being reshuffled, which is not news.
   */
  shown(keys: readonly string[]): ReadonlyMap<string, Trend> {
    const marked = keys.filter((key) => this.trends.has(key)).length;
    return marked * 2 > keys.length ? new Map() : this.trends;
  }

  /** The ranks from before say nothing about the moves since. */
  forget() {
    this.history = [];
    this.trends = new Map();
  }
}
