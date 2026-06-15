import {
  boatIntervalTicks,
  boatTroops,
  bombIntervalTicks,
  maxInvaderNations,
  nukeTier,
  selectInvasionNuke,
  warshipCount,
} from "../src/core/execution/invasion/InvasionConfig";
import { Difficulty } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";

const MIN = 600; // ticks per minute

describe("InvasionConfig.boatIntervalTicks", () => {
  test("starts around 15s and decreases monotonically to the 2s floor", () => {
    let prev = Infinity;
    for (let m = 0; m <= 20; m++) {
      const interval = boatIntervalTicks(m * MIN, Difficulty.Medium);
      expect(interval).toBeLessThanOrEqual(prev);
      expect(interval).toBeGreaterThanOrEqual(20);
      prev = interval;
    }
    expect(boatIntervalTicks(0, Difficulty.Medium)).toBe(150);
    expect(boatIntervalTicks(20 * MIN, Difficulty.Medium)).toBe(20);
  });

  test("never drops below the 2s (20 tick) floor, even past 20 min", () => {
    expect(
      boatIntervalTicks(40 * MIN, Difficulty.Impossible),
    ).toBeGreaterThanOrEqual(20);
  });

  test("higher difficulty sends boats at least as often", () => {
    const easy = boatIntervalTicks(5 * MIN, Difficulty.Easy);
    const impossible = boatIntervalTicks(5 * MIN, Difficulty.Impossible);
    expect(impossible).toBeLessThan(easy);
  });
});

describe("InvasionConfig.boatTroops", () => {
  test("starts at 30k for every difficulty and grows over time", () => {
    for (const d of [
      Difficulty.Easy,
      Difficulty.Medium,
      Difficulty.Hard,
      Difficulty.Impossible,
    ]) {
      expect(boatTroops(0, d)).toBe(30_000);
    }
    expect(boatTroops(5 * MIN, Difficulty.Medium)).toBeGreaterThan(30_000);
    expect(boatTroops(10 * MIN, Difficulty.Medium)).toBeGreaterThan(
      boatTroops(5 * MIN, Difficulty.Medium),
    );
  });

  test("harder difficulties field larger waves and the count is capped", () => {
    expect(boatTroops(10 * MIN, Difficulty.Impossible)).toBeGreaterThan(
      boatTroops(10 * MIN, Difficulty.Easy),
    );
    expect(boatTroops(1000 * MIN, Difficulty.Impossible)).toBeLessThanOrEqual(
      350_000,
    );
  });

  test("each successive boat carries slightly more troops", () => {
    const first = boatTroops(0, Difficulty.Medium, 0);
    const later = boatTroops(0, Difficulty.Medium, 10);
    expect(later).toBeGreaterThan(first);
    // Still bounded by the cap even for huge wave indices.
    expect(boatTroops(0, Difficulty.Medium, 100_000)).toBeLessThanOrEqual(
      350_000,
    );
  });
});

describe("InvasionConfig.maxInvaderNations", () => {
  test("caps fewer nations on easier difficulties (5 easy, 20 impossible)", () => {
    expect(maxInvaderNations(Difficulty.Easy)).toBe(5);
    expect(maxInvaderNations(Difficulty.Impossible)).toBe(20);
    expect(maxInvaderNations(Difficulty.Easy)).toBeLessThan(
      maxInvaderNations(Difficulty.Medium),
    );
    expect(maxInvaderNations(Difficulty.Medium)).toBeLessThan(
      maxInvaderNations(Difficulty.Hard),
    );
    expect(maxInvaderNations(Difficulty.Hard)).toBeLessThan(
      maxInvaderNations(Difficulty.Impossible),
    );
  });
});

describe("InvasionConfig.warshipCount", () => {
  test("is always 0 before minute 2", () => {
    const rng = new PseudoRandom(1);
    for (let m = 0; m < 2; m++) {
      expect(warshipCount(m * MIN, rng, Difficulty.Medium)).toBe(0);
    }
  });

  test("stays within 0-3 once active", () => {
    const rng = new PseudoRandom(42);
    for (let i = 0; i < 200; i++) {
      const n = warshipCount(10 * MIN, rng, Difficulty.Hard);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  test("averages higher later in the game (weighted toward 3)", () => {
    const avg = (elapsed: number) => {
      const rng = new PseudoRandom(7);
      let sum = 0;
      const samples = 400;
      for (let i = 0; i < samples; i++) {
        sum += warshipCount(elapsed, rng, Difficulty.Medium);
      }
      return sum / samples;
    };
    expect(avg(15 * MIN)).toBeGreaterThan(avg(3 * MIN));
  });
});

describe("InvasionConfig.nukeTier", () => {
  test("unlocks atom/hydrogen/mirv at 4/10/20 min on Medium", () => {
    expect(nukeTier(3 * MIN, Difficulty.Medium)).toBe("none");
    expect(nukeTier(4 * MIN, Difficulty.Medium)).toBe("atom");
    expect(nukeTier(9 * MIN, Difficulty.Medium)).toBe("atom");
    expect(nukeTier(10 * MIN, Difficulty.Medium)).toBe("hydrogen");
    expect(nukeTier(20 * MIN, Difficulty.Medium)).toBe("mirv");
  });

  test("higher difficulty unlocks tiers earlier", () => {
    // Atom unlocks at minute 4 on Medium, minute 2 on Impossible.
    expect(nukeTier(2 * MIN, Difficulty.Medium)).toBe("none");
    expect(nukeTier(2 * MIN, Difficulty.Impossible)).toBe("atom");
  });
});

describe("InvasionConfig.selectInvasionNuke", () => {
  test("returns null before nukes unlock", () => {
    const rng = new PseudoRandom(3);
    expect(selectInvasionNuke(0, rng, Difficulty.Medium)).toBeNull();
  });

  test("only atoms in the atom tier", () => {
    const rng = new PseudoRandom(3);
    for (let i = 0; i < 50; i++) {
      expect(selectInvasionNuke(5 * MIN, rng, Difficulty.Medium)).toBe("atom");
    }
  });

  test("MIRVs appear (~10%) only once the mirv tier is reached", () => {
    const rng = new PseudoRandom(99);
    let mirvs = 0;
    let total = 0;
    for (let i = 0; i < 2000; i++) {
      const pick = selectInvasionNuke(20 * MIN, rng, Difficulty.Medium);
      expect(pick).not.toBeNull();
      if (pick === "mirv") mirvs++;
      total++;
    }
    const ratio = mirvs / total;
    expect(ratio).toBeGreaterThan(0.03);
    expect(ratio).toBeLessThan(0.2);
  });
});

describe("InvasionConfig.bombIntervalTicks", () => {
  test("ramps down with time and difficulty but respects the floor", () => {
    expect(bombIntervalTicks(20 * MIN, Difficulty.Medium)).toBeLessThan(
      bombIntervalTicks(4 * MIN, Difficulty.Medium),
    );
    expect(
      bombIntervalTicks(20 * MIN, Difficulty.Impossible),
    ).toBeGreaterThanOrEqual(120);
  });
});
