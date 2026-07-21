import { describe, expect, it } from "vitest";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { TileSet } from "../src/core/game/TileSet";

describe("TileSet", () => {
  it("adds, reports membership and size", () => {
    const s = new TileSet();
    expect(s.size).toBe(0);
    expect(s.has(5)).toBe(false);
    s.add(5);
    s.add(9);
    s.add(5); // duplicate
    expect(s.size).toBe(2);
    expect(s.has(5)).toBe(true);
    expect(s.has(9)).toBe(true);
    expect(s.has(6)).toBe(false);
  });

  it("deletes and reports whether the value was present", () => {
    const s = new TileSet([1, 2, 3]);
    expect(s.delete(2)).toBe(true);
    expect(s.delete(2)).toBe(false);
    expect(s.delete(99)).toBe(false);
    expect(s.size).toBe(2);
    expect(s.has(2)).toBe(false);
    expect([...s]).toEqual([1, 3]);
  });

  it("iterates in insertion order across all iteration surfaces", () => {
    const values = [42, 7, 100000, 0, 13];
    const s = new TileSet(values);
    expect([...s]).toEqual(values);
    expect(Array.from(s.values())).toEqual(values);
    const seen: number[] = [];
    s.forEach((t) => seen.push(t));
    expect(seen).toEqual(values);
  });

  it("moves a value to the end on delete + re-add, matching Set", () => {
    const s = new TileSet([1, 2, 3]);
    s.delete(1);
    s.add(1);
    expect([...s]).toEqual([2, 3, 1]);
  });

  it("re-adding an existing value does not change its position", () => {
    const s = new TileSet([1, 2, 3]);
    s.add(1);
    expect([...s]).toEqual([1, 2, 3]);
  });

  it("visits entries added during forEach, matching Set", () => {
    const s = new TileSet([1, 2]);
    const seen: number[] = [];
    s.forEach((t) => {
      seen.push(t);
      if (t === 1) s.add(3);
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("skips entries deleted during forEach, matching Set", () => {
    const s = new TileSet([1, 2, 3]);
    const seen: number[] = [];
    s.forEach((t) => {
      seen.push(t);
      if (t === 1) s.delete(3);
    });
    expect(seen).toEqual([1, 2]);
  });

  it("supports deleting the current entry during iteration", () => {
    const s = new TileSet([1, 2, 3]);
    const seen: number[] = [];
    for (const t of s) {
      seen.push(t);
      s.delete(t);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(s.size).toBe(0);
  });

  it("preserves order through tombstone compaction", () => {
    const s = new TileSet();
    // Interleave adds and deletes well past the compaction thresholds.
    for (let i = 0; i < 1000; i++) s.add(i);
    for (let i = 0; i < 1000; i++) {
      if (i % 3 !== 0) s.delete(i);
    }
    for (let i = 2000; i < 2100; i++) s.add(i);
    const expected: number[] = [];
    for (let i = 0; i < 1000; i++) {
      if (i % 3 === 0) expected.push(i);
    }
    for (let i = 2000; i < 2100; i++) expected.push(i);
    expect([...s]).toEqual(expected);
    expect(s.size).toBe(expected.length);
    for (const v of expected) expect(s.has(v)).toBe(true);
    expect(s.has(1)).toBe(false);
  });

  it("clear empties the set", () => {
    const s = new TileSet([1, 2, 3]);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.has(1)).toBe(false);
    expect([...s]).toEqual([]);
    s.add(7);
    expect([...s]).toEqual([7]);
  });

  it("handles large tile refs (up to the 65535x65535 map bound)", () => {
    const big = 65535 * 65535 - 1;
    const s = new TileSet([big, 0, big - 1]);
    expect(s.has(big)).toBe(true);
    expect([...s]).toEqual([big, 0, big - 1]);
  });

  it("matches native Set behavior on a randomized operation sequence", () => {
    const random = new PseudoRandom(12345);
    const tileSet = new TileSet();
    const reference = new Set<number>();
    for (let op = 0; op < 20000; op++) {
      const value = random.nextInt(0, 500);
      if (random.chance(3)) {
        expect(tileSet.delete(value)).toBe(reference.delete(value));
      } else {
        tileSet.add(value);
        reference.add(value);
      }
      if (op % 500 === 0) {
        expect(tileSet.size).toBe(reference.size);
        expect([...tileSet]).toEqual([...reference]);
      }
    }
    expect([...tileSet]).toEqual([...reference]);
    for (let v = 0; v < 500; v++) {
      expect(tileSet.has(v)).toBe(reference.has(v));
    }
  });
});
