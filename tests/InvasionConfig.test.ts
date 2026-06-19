import {
  boatIntervalTicks,
  boatTroops,
  INVADER_BOAT_MAX,
  invaderStartingGold,
  MAX_INVADER_NATIONS,
  selectInvasionStrike,
  warshipCount,
} from "../src/core/execution/invasion/InvasionConfig";
import { PseudoRandom } from "../src/core/PseudoRandom";

const MIN = 600; // ticks per minute

describe("InvasionConfig.boatIntervalTicks", () => {
  test("starts at 15s and decreases monotonically to the 2s floor", () => {
    let prev = Infinity;
    for (let m = 0; m <= 20; m++) {
      const interval = boatIntervalTicks(m * MIN);
      expect(interval).toBeLessThanOrEqual(prev);
      expect(interval).toBeGreaterThanOrEqual(20);
      prev = interval;
    }
    expect(boatIntervalTicks(0)).toBe(150);
    expect(boatIntervalTicks(20 * MIN)).toBe(20);
  });

  test("never drops below the 2s (20 tick) floor, even past 20 min", () => {
    expect(boatIntervalTicks(40 * MIN)).toBeGreaterThanOrEqual(20);
  });
});

describe("InvasionConfig.boatTroops", () => {
  test("starts at a few thousand and accelerates to ~350k by minute 20", () => {
    expect(boatTroops(0)).toBe(3_000);
    expect(boatTroops(5 * MIN)).toBeGreaterThan(boatTroops(0));
    expect(boatTroops(10 * MIN)).toBeGreaterThan(boatTroops(5 * MIN));
    const peak = boatTroops(20 * MIN);
    expect(peak).toBeGreaterThanOrEqual(300_000);
    expect(peak).toBeLessThanOrEqual(400_000);
  });

  test("keeps growing linearly past minute 20 (never plateaus)", () => {
    expect(boatTroops(30 * MIN)).toBeGreaterThan(boatTroops(20 * MIN));
    expect(boatTroops(60 * MIN)).toBeGreaterThan(boatTroops(30 * MIN));
  });

  test("each successive boat carries slightly more troops", () => {
    expect(boatTroops(5 * MIN, 10)).toBeGreaterThan(boatTroops(5 * MIN, 0));
  });
});

describe("InvasionConfig.invaderStartingGold", () => {
  test("starts at 250k, rises past 1m, and is capped at 2m", () => {
    expect(invaderStartingGold(0)).toBe(250_000n);
    expect(invaderStartingGold(10 * MIN)).toBeGreaterThanOrEqual(1_000_000n);
    expect(invaderStartingGold(10 * MIN)).toBeGreaterThan(
      invaderStartingGold(1 * MIN),
    );
    expect(invaderStartingGold(10_000 * MIN)).toBeLessThanOrEqual(2_000_000n);
  });

  test("rises monotonically toward the cap", () => {
    let prev = -1n;
    for (let m = 0; m <= 60; m += 5) {
      const gold = invaderStartingGold(m * MIN);
      expect(gold).toBeGreaterThanOrEqual(prev);
      prev = gold;
    }
  });
});

describe("InvasionConfig.maxima", () => {
  test("twelve nations, three boats each", () => {
    expect(MAX_INVADER_NATIONS).toBe(12);
    expect(INVADER_BOAT_MAX).toBe(3);
  });
});

describe("InvasionConfig.warshipCount", () => {
  test("stays within 0-3", () => {
    const rng = new PseudoRandom(42);
    for (let i = 0; i < 500; i++) {
      const n = warshipCount(rng);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  test("is weighted very heavily toward 0 and 1; 2 and 3 are rare", () => {
    const rng = new PseudoRandom(7);
    const counts = [0, 0, 0, 0];
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      counts[warshipCount(rng)]++;
    }
    // The vast majority of waves arrive with 0 or 1 escorts.
    expect((counts[0] + counts[1]) / samples).toBeGreaterThan(0.8);
    // 2 and 3 escorts together stay uncommon, with 3 rarest of all.
    expect((counts[2] + counts[3]) / samples).toBeLessThan(0.2);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);
    const avg = (counts[1] + 2 * counts[2] + 3 * counts[3]) / samples;
    expect(avg).toBeLessThan(1);
  });
});

describe("InvasionConfig.selectInvasionStrike", () => {
  test("launches nothing in the first minute", () => {
    const rng = new PseudoRandom(3);
    for (let i = 0; i < 100; i++) {
      expect(selectInvasionStrike(0, rng)).toEqual([]);
      expect(selectInvasionStrike(30 * 10, rng)).toEqual([]); // 30s
    }
  });

  test("at minute 1: only single atoms or hydrogens", () => {
    const rng = new PseudoRandom(11);
    for (let i = 0; i < 2000; i++) {
      const strike = selectInvasionStrike(1 * MIN, rng);
      if (strike[0] === "atom") expect(strike.length).toBe(1);
      if (strike[0] === "hydrogen") expect(strike.length).toBe(1);
    }
  });

  test("only ever launches atoms or hydrogens (no MIRVs)", () => {
    const rng = new PseudoRandom(99);
    for (const m of [1, 4, 10, 20, 60, 200]) {
      for (let i = 0; i < 1000; i++) {
        for (const nuke of selectInvasionStrike(m * MIN, rng)) {
          expect(["atom", "hydrogen"]).toContain(nuke);
        }
      }
    }
  });

  test("by minute 10: atom barrages (5) and hydrogen salvos (2) appear", () => {
    const rng = new PseudoRandom(123);
    let sawHydrogen2 = false;
    let sawAtom5 = false;
    const samples = 8000;
    for (let i = 0; i < samples; i++) {
      const strike = selectInvasionStrike(10 * MIN, rng);
      if (strike.length === 0) continue;
      if (strike[0] === "hydrogen") {
        expect(strike.length).toBe(2);
        sawHydrogen2 = true;
      } else {
        expect(strike.length).toBe(5);
        sawAtom5 = true;
      }
    }
    expect(sawAtom5).toBe(true);
    expect(sawHydrogen2).toBe(true);
  });

  test("missile counts never exceed their caps deep into the game", () => {
    const rng = new PseudoRandom(55);
    for (let i = 0; i < 4000; i++) {
      const strike = selectInvasionStrike(120 * MIN, rng);
      if (strike[0] === "atom") expect(strike.length).toBeLessThanOrEqual(8);
      if (strike[0] === "hydrogen") {
        expect(strike.length).toBeLessThanOrEqual(3);
      }
    }
  });
});
