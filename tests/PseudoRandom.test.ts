import { PseudoRandom } from "../src/core/PseudoRandom";

describe("PseudoRandom", () => {
  test("same seed produces an identical sequence", () => {
    const a = new PseudoRandom(42);
    const b = new PseudoRandom(42);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test("same seed produces identical derived values", () => {
    const a = new PseudoRandom(987654);
    const b = new PseudoRandom(987654);
    for (let i = 0; i < 100; i++) {
      expect(a.nextInt(0, 1000)).toBe(b.nextInt(0, 1000));
    }
    expect(a.nextID()).toBe(b.nextID());
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(a.shuffleArray(arr)).toEqual(b.shuffleArray(arr));
  });

  test("different seeds produce different sequences", () => {
    const a = new PseudoRandom(1);
    const b = new PseudoRandom(2);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() === b.next()) same++;
    }
    expect(same).toBeLessThan(5);
  });

  test("consecutive integer seeds are not correlated", () => {
    // Weak seeding schemes make adjacent seeds (common: tick numbers,
    // sequential hashes) produce similar streams.
    const values: number[] = [];
    for (let seed = 1000; seed < 1100; seed++) {
      values.push(new PseudoRandom(seed).nextInt(0, 100));
    }
    const distinct = new Set(values).size;
    expect(distinct).toBeGreaterThan(50);
  });

  test("next() stays within [0, 1)", () => {
    const r = new PseudoRandom(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("next() is roughly uniform", () => {
    const r = new PseudoRandom(1234);
    const n = 20000;
    let sum = 0;
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < n; i++) {
      const v = r.next();
      sum += v;
      buckets[Math.floor(v * 10)]++;
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
    for (const count of buckets) {
      // Expected 2000 per bucket; allow generous slack.
      expect(count).toBeGreaterThan(1700);
      expect(count).toBeLessThan(2300);
    }
  });

  test("nextInt returns integers in [min, max)", () => {
    const r = new PseudoRandom(99);
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      const v = r.nextInt(3, 8);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(8);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  test("nextInt with a single-value range always returns it", () => {
    const r = new PseudoRandom(5);
    for (let i = 0; i < 100; i++) {
      expect(r.nextInt(4, 5)).toBe(4);
    }
  });

  test("nextInt floors non-integer bounds", () => {
    const r = new PseudoRandom(5);
    for (let i = 0; i < 100; i++) {
      const v = r.nextInt(1.9, 4.7);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThan(4);
    }
  });

  test("nextFloat stays within [min, max)", () => {
    const r = new PseudoRandom(11);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextFloat(2.5, 3.5);
      expect(v).toBeGreaterThanOrEqual(2.5);
      expect(v).toBeLessThan(3.5);
    }
  });

  test("nextID returns 8 alphanumeric characters", () => {
    const r = new PseudoRandom(123);
    for (let i = 0; i < 100; i++) {
      expect(r.nextID()).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  test("randElement picks members and throws on empty", () => {
    const r = new PseudoRandom(77);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(r.randElement(arr));
    }
    expect(() => r.randElement([])).toThrow();
  });

  test("randFromSet picks members and throws on empty", () => {
    const r = new PseudoRandom(78);
    const set = new Set(["x", "y", "z"]);
    for (let i = 0; i < 100; i++) {
      expect(set.has(r.randFromSet(set))).toBe(true);
    }
    expect(() => r.randFromSet(new Set())).toThrow();
  });

  test("chance(1) is always true, chance(large) is mostly false", () => {
    const r = new PseudoRandom(31);
    for (let i = 0; i < 100; i++) {
      expect(r.chance(1)).toBe(true);
    }
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (r.chance(1000)) hits++;
    }
    expect(hits).toBeLessThan(10);
  });

  test("shuffleArray returns a permutation and leaves the input unchanged", () => {
    const r = new PseudoRandom(55);
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const copy = [...input];
    const shuffled = r.shuffleArray(input);
    expect(input).toEqual(copy);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(copy);
  });
});
