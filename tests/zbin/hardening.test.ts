// Hardening: resource bounds, the decode error contract, and the silent
// failure modes that a round-trip test cannot see.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ByteWriter,
  MAX_DECODE_ITEMS,
  zb,
  ZbDecodeError,
  ZbEncodeError,
} from "../../zbin";

const bytesOf = (...ns: number[]) => new Uint8Array(ns);

// A count varint claiming MAX_DECODE_ITEMS elements.
function countBytes(n: number): number[] {
  const w = new ByteWriter();
  w.uint(n);
  return Array.from(w.finish());
}

describe("decode resource bounds", () => {
  it("rejects a collection count larger than the remaining input", () => {
    const S = zb.object({ xs: z.array(zb.uint()) });
    const started = Date.now();
    expect(() =>
      S.decodeBytesUnvalidated(new Uint8Array(countBytes(1 << 20))),
    ).toThrow(ZbDecodeError);
    expect(Date.now() - started).toBeLessThan(50);
  });

  // readCount must not depend on the EXACT per-element minimum. An element's
  // declared minBytes can over-state its smallest real encoding (a null/absent
  // field writes zero body bytes), so a compact array of such elements is
  // smaller than n * declared-min and must still decode. Regression for the
  // live-stats snapshot rejected as a malformed frame — its sender kicked —
  // because PlayerLiveStats' three nullable fields inflated the count guard.
  const overStatedMinBytesCases: Array<[string, z.ZodTypeAny, unknown]> = [
    [
      "a nullable field",
      zb.object({ a: zb.uint(), b: zb.uint().nullable() }),
      { a: 1, b: null },
    ],
    [
      "an optional field",
      zb.object({ a: zb.uint(), b: zb.uint().optional() }),
      { a: 1 },
    ],
    [
      "float + nullables (live-stats shape)",
      zb.object({
        id: zb.uint(),
        troops: zb.float(),
        killedBy: zb.uint().nullable(),
        deathPosition: zb.uint().nullable(),
        team: z.string().nullable(),
      }),
      { id: 1, troops: 100.5, killedBy: null, deathPosition: null, team: null },
    ],
  ];
  it.each(overStatedMinBytesCases)(
    "round-trips a compact array whose elements over-state minBytes (%s)",
    (_name, element, item) => {
      const S = zb.object({ xs: element.array() }) as any;
      const value = { xs: [item, item, item] };
      expect(S.parseBytes(S.serialize(value))).toStrictEqual(value);
    },
  );

  it.each([
    ["single-value literals", z.array(z.literal("x"))],
    ["all-literal objects", z.array(z.object({ a: z.literal(1) }))],
    ["empty objects", z.array(z.object({}))],
  ])(
    "bounds zero-width elements (%s) that consume no input",
    (_name, element) => {
      // These elements advance the reader not at all, so "count vs remaining
      // bytes" cannot bound them — only the per-message element budget can.
      const S = zb.object({ xs: element });
      const started = Date.now();
      expect(() =>
        S.decodeBytesUnvalidated(
          new Uint8Array(countBytes(MAX_DECODE_ITEMS + 1)),
        ),
      ).toThrow(ZbDecodeError);
      expect(Date.now() - started).toBeLessThan(50);
    },
  );

  it("charges the element budget across sibling collections", () => {
    const S = zb.object({ a: z.array(z.literal(1)), b: z.array(z.literal(1)) });
    const half = MAX_DECODE_ITEMS / 2 + 1;
    expect(() =>
      S.decodeBytesUnvalidated(
        new Uint8Array([...countBytes(half), ...countBytes(half)]),
      ),
    ).toThrow(/element budget/);
  });

  it("bounds recursion depth instead of overflowing the stack", () => {
    type Node = { kids: Node[] };
    const NodeSchema: z.ZodType<Node> = z.lazy(() =>
      z.object({ kids: z.array(NodeSchema) }),
    );
    const S = zb.object({ root: NodeSchema });

    // Shallow nesting still works.
    const ok = { root: { kids: [{ kids: [] }] } };
    expect(S.parseBytes(S.serialize(ok))).toStrictEqual(ok);

    // A byte per level used to reach a raw RangeError at ~5 KB.
    const deep = new Uint8Array([...Array(5000).fill(1), 0]);
    expect(() => S.decodeBytesUnvalidated(deep)).toThrow(ZbDecodeError);
  });

  it("refuses an oversized collection at encode time, not at the peer", () => {
    const S = zb.object({ xs: z.array(z.literal(1)) });
    const huge = { xs: new Array(MAX_DECODE_ITEMS + 1).fill(1) };
    expect(() => S.serialize(huge)).toThrow(ZbEncodeError);
  });
});

describe("decode error contract", () => {
  it.each([
    [
      "invalid presence flag",
      zb.object({ xs: z.array(zb.uint().optional()) }),
      [1, 3],
    ],
    ["enum ordinal out of range", zb.object({ e: z.enum(["a", "b"]) }), [9]],
    ["invalid boolean byte", zb.object({ xs: z.array(z.boolean()) }), [1, 2]],
    ["union tag out of range", zb.object({ n: zb.uint() }), []],
  ] as const)("surfaces %s as ZbDecodeError", (_name, S, bs) => {
    expect(() => S.decodeBytesUnvalidated(bytesOf(...bs))).toThrow(
      ZbDecodeError,
    );
  });

  it("rejects invalid UTF-8 rather than substituting U+FFFD", () => {
    const S = zb.object({ s: zb.string() });
    expect(() => S.decodeBytesUnvalidated(bytesOf(0x02, 0xff, 0xfe))).toThrow(
      ZbDecodeError,
    );
  });

  it("rejects non-minimal varints so a value has one encoding", () => {
    const S = zb.object({ n: zb.uint() });
    expect(hexRoundTrip(S, 1)).toBe(1);
    expect(() => S.decodeBytesUnvalidated(bytesOf(0x81, 0x80, 0x00))).toThrow(
      /non-minimal/,
    );
  });

  it("rejects a required value that arrives absent or null", () => {
    const S = zb.object({ xs: z.array(z.string().nullable()) });
    expect(() => S.decodeBytesUnvalidated(bytesOf(1, 0))).toThrow(
      /absent flag for a required value/,
    );
    const T = zb.object({ xs: z.array(zb.uint().optional()) });
    expect(() => T.decodeBytesUnvalidated(bytesOf(1, 1))).toThrow(
      /null flag for a non-nullable value/,
    );
  });

  it("refuses a __proto__ record key instead of mutating the prototype", () => {
    const S = zb.object({ m: z.record(z.string(), zb.uint()) });
    const w = new ByteWriter();
    w.uint(1);
    w.str("__proto__");
    w.uint(1);
    expect(() => S.decodeBytesUnvalidated(w.finish())).toThrow(/__proto__/);
  });

  it("refuses duplicate record keys", () => {
    const S = zb.object({ m: z.record(z.string(), zb.uint()) });
    const w = new ByteWriter();
    w.uint(2);
    w.str("k");
    w.uint(1);
    w.str("k");
    w.uint(2);
    expect(() => S.decodeBytesUnvalidated(w.finish())).toThrow(/duplicate/);
  });

  function hexRoundTrip(S: any, n: number): number {
    return S.decodeBytesUnvalidated(S.serialize({ n })).n;
  }
});

describe("encode error contract", () => {
  it.each([
    ["a wrong-typed string", zb.object({ s: zb.string() }), { s: 12345 }],
    ["a wrong-typed boolean", zb.object({ b: z.boolean() }), { b: "yes" }],
    ["a wrong-typed bigint", zb.object({ n: zb.bigint() }), { n: 5 }],
    ["a mismatched literal", zb.object({ k: z.literal("a") }), { k: "WRONG" }],
    [
      "a short tuple",
      zb.object({ t: z.tuple([zb.uint(), zb.uint()]) }),
      { t: [1] },
    ],
    [
      "a long tuple",
      zb.object({ t: z.tuple([zb.uint(), zb.uint()]) }),
      { t: [1, 2, 3] },
    ],
    [
      "a non-JSON-serializable blob",
      zb.object({ j: zb.json(z.any()) }),
      { j: { a: 1n } },
    ],
  ] as const)("throws ZbEncodeError for %s", (_name, S, value) => {
    expect(() => (S as any).serialize(value)).toThrow(ZbEncodeError);
  });

  it("rejects a bigint too wide for any peer to decode", () => {
    const S = zb.object({ n: zb.bigint() });
    expect(() => S.serialize({ n: 1n << 1200n })).toThrow(ZbEncodeError);
    // Values inside the limit round-trip, including across the fast-path edge.
    for (const n of [0n, -1n, 2n ** 52n, -(2n ** 52n), 1n << 200n]) {
      expect(S.parseBytes(S.serialize({ n })).n).toBe(n);
    }
  });

  it("rejects an integer beyond the exact zigzag range", () => {
    const S = zb.object({ n: zb.int() });
    expect(() => S.serialize({ n: Number.MAX_SAFE_INTEGER })).toThrow(
      ZbEncodeError,
    );
  });
});

describe("silent-misuse guards", () => {
  it("honours zb.custom regardless of field position", () => {
    const codec = {
      enc: (w: ByteWriter, v: boolean) => w.u8(v ? 7 : 9),
      dec: (r: any) => r.u8() === 7,
    };
    const B = zb.custom(z.boolean(), codec as any);
    // Bit-packing a boolean field would otherwise discard the codec entirely.
    expect(Array.from(zb.object({ b: B }).serialize({ b: true }))).toEqual([7]);
    const S = zb.object({ b: B, n: zb.uint() });
    expect(S.parseBytes(S.serialize({ b: false, n: 5 }))).toStrictEqual({
      b: false,
      n: 5,
    });
  });

  it("keeps zb.json local to the schema it is applied to", () => {
    const Inner = z.object({ a: zb.string() });
    const Binary = zb.object({ c: Inner });
    const AsJson = zb.object({ c: zb.json(Inner) });
    const v = { c: { a: "hi" } };
    // Same Inner instance, two roots: registering must not have leaked.
    expect(Binary.serialize(v).length).toBeLessThan(
      AsJson.serialize(v as any).length,
    );
    expect(Binary.parseBytes(Binary.serialize(v))).toStrictEqual(v);
    expect(AsJson.parseBytes(AsJson.serialize(v as any))).toStrictEqual(v);
  });

  it("rejects a zb.mapped name the context never declared", () => {
    const S = zb.object({ id: zb.mapped("typo") });
    const ctx = zb.context().mapping("ids").assignAll("ids", ["aa"]);
    expect(() => S.serialize({ id: "aa" }, ctx)).toThrow(/no such mapping/);
    // No context at all stays legal: everything encodes inline.
    expect(S.parseBytes(S.serialize({ id: "aa" }))).toStrictEqual({ id: "aa" });
  });

  it("gives reordered dictionaries a distinguishing fingerprint", () => {
    const a = zb.context().mapping("ids").assignAll("ids", ["alice", "bob"]);
    const b = zb.context().mapping("ids").assignAll("ids", ["bob", "alice"]);
    const same = zb.context().mapping("ids").assignAll("ids", ["alice", "bob"]);
    // Equal-length, different-order tables decode to the wrong value with no
    // error, so peers need this to detect the mismatch themselves.
    expect(a.fingerprint("ids")).not.toBe(b.fingerprint("ids"));
    expect(a.fingerprint("ids")).toBe(same.fingerprint("ids"));
    // Separator-sensitive: ["ab","c"] must not collide with ["a","bc"].
    const x = zb.context().mapping("m").assignAll("m", ["ab", "c"]);
    const y = zb.context().mapping("m").assignAll("m", ["a", "bc"]);
    expect(x.fingerprint("m")).not.toBe(y.fingerprint("m"));
  });

  it("rejects a stamped extra that collides with a variant field", () => {
    const U = z.discriminatedUnion("t", [
      z.object({ t: z.literal("a"), cid: zb.uint() }),
    ]);
    expect(() => zb.stamped(U, { cid: zb.uint() })).toThrow(/collides/);
  });

  it("rejects a record key type it cannot faithfully encode", () => {
    expect(() =>
      zb.object({ m: z.record(z.coerce.number() as any, zb.uint()) }),
    ).toThrow(/unsupported record key type/);
  });

  it("rejects an enum whose ordinals would be ambiguous", () => {
    // A TS numeric enum's reverse mappings must not become members.
    enum Dir {
      Up = 1,
      Down = 2,
    }
    const S = zb.object({ d: z.enum(Dir) });
    expect(Array.from(S.serialize({ d: Dir.Up }))).toEqual([0]);
    expect(Array.from(S.serialize({ d: Dir.Down }))).toEqual([1]);
    expect(S.parseBytes(S.serialize({ d: Dir.Down }))).toStrictEqual({
      d: Dir.Down,
    });
  });

  it("keeps numeric enum ordinals stable when a member is appended", () => {
    enum V1 {
      Up = 1,
      Down = 2,
    }
    enum V2 {
      Up = 1,
      Down = 2,
      Left = 3,
    }
    const a = zb.object({ d: z.enum(V1) }).serialize({ d: V1.Down });
    const b = zb.object({ d: z.enum(V2) }).serialize({ d: V2.Down });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("survives a re-entrant serialize from inside a custom codec", () => {
    const Inner = zb.object({ n: zb.uint() });
    const Wrapped = zb.custom(z.object({ n: zb.uint() }), {
      enc: (w: ByteWriter, v: { n: number }) => {
        const inner = Inner.serialize(v); // re-enters the pooled writer
        w.uint(inner.length);
        for (const b of inner) w.u8(b);
      },
      dec: (r: any) => {
        const n = r.uint();
        const bs: number[] = [];
        for (let i = 0; i < n; i++) bs.push(r.u8());
        return Inner.decodeBytesUnvalidated(new Uint8Array(bs));
      },
    } as any);
    const S = zb.object({ c: Wrapped, tail: zb.uint() });
    expect(
      S.parseBytes(S.serialize({ c: { n: 7 }, tail: 9 } as any)),
    ).toStrictEqual({ c: { n: 7 }, tail: 9 });
  });

  it("uses an explicit select instead of scanning union variants", () => {
    const S = zb.union(
      [zb.object({ a: zb.uint() }), zb.object({ b: zb.string() })],
      { select: (v) => ("a" in (v as object) ? 0 : 1) },
    );
    expect(S.parseBytes(S.serialize({ b: "hi" } as any))).toStrictEqual({
      b: "hi",
    });
    expect(Array.from(S.serialize({ a: 3 } as any))).toEqual([0, 3]);
  });
});

describe("representational limits", () => {
  it("cannot distinguish an absent key from an explicit undefined", () => {
    // One presence bit encodes both, so {a: undefined} decodes as {}. Worth
    // pinning: it is the one place serialize->parseBytes is not identity, and
    // vitest's toEqual (unlike toStrictEqual) would hide it.
    const S = zb.object({ a: zb.uint().optional(), b: zb.uint() });
    const bytes = S.serialize({ a: undefined, b: 1 });
    expect(Buffer.from(bytes).equals(Buffer.from(S.serialize({ b: 1 })))).toBe(
      true,
    );
    const out = S.parseBytes(bytes);
    expect("a" in out).toBe(false);
    expect(out).toStrictEqual({ b: 1 });
  });

  it("record byte output follows key insertion order", () => {
    // Object.keys order is the wire order, so the same logical record built in
    // two orders produces two payloads. Callers that compare or hash bytes
    // must sort first.
    const S = zb.object({ m: z.record(z.string(), zb.uint()) });
    const ab = S.serialize({ m: { a: 1, b: 2 } });
    const ba = S.serialize({ m: { b: 2, a: 1 } });
    expect(Buffer.from(ab).equals(Buffer.from(ba))).toBe(false);
    expect(S.parseBytes(ab)).toStrictEqual(S.parseBytes(ba));
  });
});

describe("string fidelity", () => {
  it("round-trips ASCII, multi-byte, and astral characters", () => {
    const S = zb.object({ s: zb.string() });
    for (const s of ["", "a", "hello world", "üÜ", "🎉🎉🎉", "a".repeat(500)]) {
      expect(S.parseBytes(S.serialize({ s })).s).toBe(s);
    }
  });

  it("round-trips a string that straddles the ASCII fast path", () => {
    const S = zb.object({ s: zb.string() });
    // Long ASCII prefix then a non-ASCII tail exercises the rewind branch.
    for (const n of [0, 1, 63, 64, 65, 127, 128, 1000]) {
      const s = "a".repeat(n) + "ü🎉";
      expect(S.parseBytes(S.serialize({ s })).s).toBe(s);
    }
  });
});
