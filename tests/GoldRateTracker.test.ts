import { describe, expect, it } from "vitest";
import { GoldRateTracker } from "../src/client/hud/layers/lib/GoldRateTracker";

// The game sim runs at a fixed 10 ticks/second; rates are per IN-GAME minute
// (600 ticks), not per wall-clock minute — a frozen sim clock must yield 0.
const TICKS_PER_MIN = 600;

function sample(income: number, trade = 0, train = 0, piracy = 0) {
  return { income, trade, train, piracy };
}

describe("GoldRateTracker", () => {
  it("returns 0 until at least two samples exist", () => {
    const t = new GoldRateTracker();
    expect(t.goldIncomePerMin(1)).toBe(0);
    t.record(1, sample(1000), 0);
    expect(t.goldIncomePerMin(1)).toBe(0);
  });

  it("extrapolates the delta over in-game time to a per-minute rate", () => {
    const t = new GoldRateTracker();
    t.record(1, sample(1000), 0);
    // 30 in-game seconds (half a minute) later: +600 income → 1200/min.
    t.record(1, sample(1600), 300);
    expect(t.goldIncomePerMin(1)).toBeCloseTo(1200);
  });

  it("returns 0 when the sim clock is frozen (duplicate ticks)", () => {
    const t = new GoldRateTracker();
    t.record(1, sample(1000), 500);
    t.record(1, sample(5000), 500); // income changed, time did not
    expect(t.goldIncomePerMin(1)).toBe(0);
  });

  it("evicts samples older than the 2-in-game-minute window", () => {
    const t = new GoldRateTracker();
    t.record(1, sample(0), 0);
    t.record(1, sample(600), TICKS_PER_MIN); // still inside the window
    t.record(1, sample(1200), 2 * TICKS_PER_MIN); // first sample now evicted
    t.record(1, sample(1800), 3 * TICKS_PER_MIN);
    // Window spans ticks 1200..1800 → +600 income over 1 min.
    expect(t.goldIncomePerMin(1)).toBeCloseTo(600);
  });

  it("computes independent rates per source and per player", () => {
    const t = new GoldRateTracker();
    t.record(1, sample(0, 100, 200, 300), 0);
    t.record(1, sample(0, 400, 200, 900), TICKS_PER_MIN / 2);
    t.record(2, sample(0, 0, 0, 0), 0);
    t.record(2, sample(0, 50, 0, 0), TICKS_PER_MIN / 2);
    expect(t.shipTradeGoldPerMin(1)).toBeCloseTo(600); // +300 over 0.5 min
    expect(t.trainTradeGoldPerMin(1)).toBe(0); // unchanged
    expect(t.piracyGoldPerMin(1)).toBeCloseTo(1200); // +600 over 0.5 min
    expect(t.shipTradeGoldPerMin(2)).toBeCloseTo(100);
    expect(t.piracyGoldPerMin(2)).toBe(0);
  });

  it("income rate is gross — spending never reduces it", () => {
    // The income counter only grows; the balance (not tracked here) may
    // drop from spending without affecting the rate.
    const t = new GoldRateTracker();
    t.record(1, sample(1000), 0);
    t.record(1, sample(1600), TICKS_PER_MIN / 2);
    expect(t.goldIncomePerMin(1)).toBeCloseTo(1200);
  });

  it("forgets a player's history", () => {
    const t = new GoldRateTracker();
    t.record(1, sample(0), 0);
    t.record(1, sample(600), TICKS_PER_MIN / 2);
    t.forget(1);
    expect(t.goldIncomePerMin(1)).toBe(0);
  });

  it("resetAll drops every player's history (new game in same page)", () => {
    const t = new GoldRateTracker();
    // Previous game left samples at high ticks; smallIDs restart from 1.
    t.record(1, sample(1000), 14000);
    t.record(2, sample(2000), 14100);

    t.resetAll();

    // Fresh game: rates read 0 until two new samples exist, and a new
    // sample at a low tick is not mixed with stale high-tick data.
    expect(t.goldIncomePerMin(1)).toBe(0);
    t.record(1, sample(500), 100);
    t.record(1, sample(1100), 700); // +600 income over 1 in-game minute
    expect(t.goldIncomePerMin(1)).toBeCloseTo(600);
    expect(t.goldIncomePerMin(2)).toBe(0);
  });
});
