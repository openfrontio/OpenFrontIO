import {
  decodeSnapshotValue,
  encodeSnapshotValue,
} from "../../../src/core/snapshot/SnapshotCodec";

describe("snapshot codec", () => {
  test("round-trips every supported value kind", () => {
    const value = {
      u: 0,
      big: 2 ** 53 - 1,
      neg: -12345,
      f: 0.1,
      inf: Infinity,
      ninf: -Infinity,
      nan: NaN,
      negZero: -0,
      b: 123456789012345678901234567890n,
      nb: -5n,
      s: "héllo",
      again: "héllo",
      t: true,
      n: null,
      un: undefined,
      arr: [1, "a", [2, { x: 3 }]],
      tiles: new Uint32Array([1, 2, 4_000_000_000]),
      bytes: new Uint8Array([0, 255]),
      f32: new Float32Array([0.5, Infinity]),
      nested: { a: { b: { c: [] } } },
    };
    const back = decodeSnapshotValue(encodeSnapshotValue(value)) as Record<
      string,
      unknown
    >;
    expect(back).toEqual(value);
    expect(Object.is(back.negZero, -0)).toBe(true);
    expect(Object.keys(back)).toEqual(Object.keys(value));
    expect("un" in back).toBe(true);
  });

  test("delta-encodes tile lists, including jumps in both directions", () => {
    const tiles = new Uint32Array([0xffffffff, 0, 5, 4, 3, 1_000_000, 7]);
    const back = decodeSnapshotValue(encodeSnapshotValue(tiles));
    expect(back).toBeInstanceOf(Uint32Array);
    expect(back).toEqual(tiles);
    // A spatially coherent run costs about one byte per tile.
    const run = Uint32Array.from({ length: 1000 }, (_, i) => 50_000 + i);
    expect(encodeSnapshotValue(run).length).toBeLessThan(1100);
  });

  test("interns repeated strings", () => {
    const many = encodeSnapshotValue(
      Array.from({ length: 100 }, () => ({ someLongFieldName: 1 })),
    );
    // Written inline, the key alone would be 17+ bytes per element.
    expect(many.length).toBeLessThan(100 * 8);
  });

  test("is deterministic", () => {
    const v = { a: [1, 2n, "x"], b: new Uint16Array([7]) };
    expect(encodeSnapshotValue(v)).toEqual(encodeSnapshotValue(v));
  });

  test("rejects class instances", () => {
    expect(() => encodeSnapshotValue({ m: new Map() })).toThrow(/plain/);
    expect(() => encodeSnapshotValue({ s: new Set() })).toThrow(/plain/);
  });

  test("rejects a __proto__ key", () => {
    const bytes = encodeSnapshotValue(JSON.parse('{"__proto__": {"x": 1}}'));
    expect(() => decodeSnapshotValue(bytes)).toThrow(/__proto__/);
  });

  test("rejects unknown typed array kinds", () => {
    // Tag.TypedArray, kind 8, zero length.
    expect(() => decodeSnapshotValue(new Uint8Array([12, 8, 0]))).toThrow(
      /typed array kind/,
    );
  });

  test("rejects trailing bytes and bad tags", () => {
    const bytes = encodeSnapshotValue(1);
    expect(() => decodeSnapshotValue(new Uint8Array([...bytes, 0]))).toThrow();
    expect(() => decodeSnapshotValue(new Uint8Array([99]))).toThrow();
  });
});
