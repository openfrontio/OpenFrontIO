/**
 * Tracks per-player gold (and gold-source) values over a rolling window of
 * in-game time and computes per-minute rates.  Used by the leaderboard
 * "Gold Income/min", "Ship Trade Gold/min", "Train Trade Gold/min" and
 * "Piracy Gold/min" columns.
 *
 * Time is measured in game ticks (the sim clock, 10 ticks/second), NOT wall
 * time — when the in-game timer stops (pause / frozen sim) the rates read 0
 * instead of silently decaying. The window spans 2 in-game minutes to smooth
 * lumpy events (ship arrivals); because the tracked values are cumulative,
 * the two-point slope over the window IS the moving average of the per-interval
 * rates (consecutive deltas telescope). Call {@link record} once per player
 * per refresh with the current values and tick, then read back the smoothed
 * rate via {@link goldIncomePerMin}, {@link shipTradeGoldPerMin},
 * {@link trainTradeGoldPerMin} or {@link piracyGoldPerMin}.
 */

/** One snapshot of cumulative gold values for a player. */
export interface GoldSample {
  /** Cumulative gold received from all sources (never decreases). */
  income: number;
  /** Cumulative gold earned from trade ships. */
  trade: number;
  /** Cumulative gold earned from trains. */
  train: number;
  /** Cumulative gold earned from captured trade ships. */
  piracy: number;
}

interface Sample extends GoldSample {
  tick: number;
}

/** The simulation runs at a fixed 10 ticks/second (see GameView.elapsedGameSeconds). */
const TICKS_PER_MINUTE = 10 * 60;
// Smooth with a 2-in-game-minute window: arrivals are lumpy (one ship = one
// large step), and a longer window halves the apparent spike of a single
// event at the cost of slower reaction. The rate itself is still per minute.
const WINDOW_TICKS = 2 * TICKS_PER_MINUTE;
const MAX_SAMPLES = 240; // generous cap (2 samples/second worst-case)

export class GoldRateTracker {
  private readonly history = new Map<number, Sample[]>();

  /**
   * Record a snapshot for the given player.  Call once per refresh per player.
   *
   * @param smallID  Player smallID (map key).
   * @param sample   Current cumulative values (numbers, not bigint).
   * @param tick     Current game tick (GameView.ticks()) — the sim clock.
   */
  record(smallID: number, sample: GoldSample, tick: number): void {
    let samples = this.history.get(smallID);
    if (!samples) {
      samples = [];
      this.history.set(smallID, samples);
    }

    samples.push({ ...sample, tick });

    // Evict samples outside the in-game-time window.
    const cutoff = tick - WINDOW_TICKS;
    while (samples.length > 0 && samples[0].tick < cutoff) {
      samples.shift();
    }
    // Hard cap to bound memory.
    if (samples.length > MAX_SAMPLES) {
      samples.splice(0, samples.length - MAX_SAMPLES);
    }
  }

  /** Remove all history for a player (call when they die / leave). */
  forget(smallID: number): void {
    this.history.delete(smallID);
  }

  /** Gold-income-per-minute rate (gross received, spending not deducted). */
  goldIncomePerMin(smallID: number): number {
    return this.rate(smallID, (s) => s.income);
  }

  /** Ship-trade-gold-per-minute rate (cumulative delta). */
  shipTradeGoldPerMin(smallID: number): number {
    return this.rate(smallID, (s) => s.trade);
  }

  /** Train-trade-gold-per-minute rate (cumulative delta). */
  trainTradeGoldPerMin(smallID: number): number {
    return this.rate(smallID, (s) => s.train);
  }

  /** Piracy-gold-per-minute rate (cumulative delta). */
  piracyGoldPerMin(smallID: number): number {
    return this.rate(smallID, (s) => s.piracy);
  }

  private rate(smallID: number, pick: (s: Sample) => number): number {
    const samples = this.history.get(smallID);
    if (!samples || samples.length < 2) return 0;

    const first = samples[0];
    const last = samples[samples.length - 1];
    // Delta over in-game time: a frozen sim clock (dtTick = 0) yields 0
    // rather than a wall-time-based value that keeps changing.
    const dtMin = (last.tick - first.tick) / TICKS_PER_MINUTE;
    if (dtMin <= 0) return 0;

    return (pick(last) - pick(first)) / dtMin;
  }
}

/** Singleton shared across the stats columns. */
export const goldRateTracker = new GoldRateTracker();
