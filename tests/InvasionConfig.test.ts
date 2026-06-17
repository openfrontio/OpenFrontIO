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
  test("starts at a few thousand, rises, and is capped at 1m", () => {
    expect(invaderStartingGold(0)).toBe(3_000n);
    expect(invaderStartingGold(10 * MIN)).toBeGreaterThan(
      invaderStartingGold(1 * MIN),
    );
    expect(invaderStartingGold(10_000 * MIN)).toBeLessThanOrEqual(1_000_000n);
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
  test("ten nations, three boats each", () => {
    expect(MAX_INVADER_NATIONS).toBe(10);
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

  test("is weighted toward 0 and 1", () => {
    const rng = new PseudoRandom(7);
    const counts = [0, 0, 0, 0];
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      counts[warshipCount(rng)]++;
    }
    // Most waves should arrive with 0 or 1 escorts.
    expect((counts[0] + counts[1]) / samples).toBeGreaterThan(0.6);
    expect(counts[0]).toBeGreaterThan(counts[3]);
    const avg = (counts[1] + 2 * counts[2] + 3 * counts[3]) / samples;
    expect(avg).toBeLessThan(1.5);
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

  test("at minute 1: only single atoms/hydrogens, never a MIRV", () => {
    const rng = new PseudoRandom(11);
    for (let i = 0; i < 2000; i++) {
      const strike = selectInvasionStrike(1 * MIN, rng);
      expect(strike).not.toContain("mirv");
      if (strike[0] === "atom") expect(strike.length).toBe(1);
      if (strike[0] === "hydrogen") expect(strike.length).toBe(1);
    }
  });

  test("MIRVs never appear before minute 4", () => {
    const rng = new PseudoRandom(99);
    for (let i = 0; i < 3000; i++) {
      expect(selectInvasionStrike(3 * MIN, rng)).not.toContain("mirv");
    }
  });

  test("by minute 10: atoms barrage (5), hydrogens (2), rare MIRVs appear", () => {
    const rng = new PseudoRandom(123);
    let mirvs = 0;
    let sawHydrogen2 = false;
    let sawAtom5 = false;
    const samples = 8000;
    for (let i = 0; i < samples; i++) {
      const strike = selectInvasionStrike(10 * MIN, rng);
      if (strike.length === 0) continue;
      if (strike[0] === "mirv") {
        expect(strike.length).toBe(1);
        mirvs++;
      } else if (strike[0] === "hydrogen") {
        expect(strike.length).toBe(2);
        sawHydrogen2 = true;
      } else {
        expect(strike.length).toBe(5);
        sawAtom5 = true;
      }
    }
    expect(sawAtom5).toBe(true);
    expect(sawHydrogen2).toBe(true);
    // ~3% of boats fire a MIRV once the tier is reached.
    expect(mirvs).toBeGreaterThan(0);
    expect(mirvs / samples).toBeLessThan(0.1);
  });

  test("missile counts never exceed their caps deep into the game", () => {
    const rng = new PseudoRandom(55);
    for (let i = 0; i < 4000; i++) {
      const strike = selectInvasionStrike(120 * MIN, rng);
      if (strike[0] === "atom") expect(strike.length).toBeLessThanOrEqual(8);
      if (strike[0] === "hydrogen")
        expect(strike.length).toBeLessThanOrEqual(3);
      if (strike[0] === "mirv") expect(strike.length).toBe(1);
    }
  });
});
