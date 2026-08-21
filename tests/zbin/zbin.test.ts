import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ByteReader,
  ByteWriter,
  zb,
  ZbDecodeError,
  ZbEncodeError,
} from "../../zbin";

describe("byte primitives", () => {
  it("round-trips uints across the full safe range", () => {
    const values = [
      0,
      1,
      127,
      128,
      300,
      2 ** 31 - 1,
      2 ** 31,
      2 ** 32,
      2 ** 52,
      Number.MAX_SAFE_INTEGER,
    ];
    const w = new ByteWriter();
    for (const v of values) w.uint(v);
    const r = new ByteReader(w.finish());
    for (const v of values) expect(r.uint()).toBe(v);
    r.expectEnd();
  });

  it("round-trips signed ints via zigzag", () => {
    const values = [0, -1, 1, -64, 64, -(2 ** 40), 2 ** 40];
    const w = new ByteWriter();
    for (const v of values) w.int(v);
    const r = new ByteReader(w.finish());
    for (const v of values) expect(r.int()).toBe(v);
  });

  it("round-trips float64 bit-exactly", () => {
    const values = [0, -0, 0.1, 1 / 3, 12345.6789, 1e300, -1e-300];
    const w = new ByteWriter();
    for (const v of values) w.f64(v);
    const r = new ByteReader(w.finish());
    for (const v of values) expect(r.f64()).toBe(v);
  });

  it("round-trips bigints", () => {
    const values = [0n, 1n, -1n, 2n ** 100n, -(2n ** 100n)];
    const w = new ByteWriter();
    for (const v of values) w.bigint(v);
    const r = new ByteReader(w.finish());
    for (const v of values) expect(r.bigint()).toBe(v);
  });

  it("round-trips strings incl. multi-byte and emoji", () => {
    const values = ["", "hello", "üÜ", "🎉🎉🎉", "a".repeat(1000)];
    const w = new ByteWriter();
    for (const v of values) w.str(v);
    const r = new ByteReader(w.finish());
    for (const v of values) expect(r.str()).toBe(v);
  });

  it("rejects non-integers and negatives in uint", () => {
    const w = new ByteWriter();
    expect(() => w.uint(1.5)).toThrow(ZbEncodeError);
    expect(() => w.uint(-1)).toThrow(ZbEncodeError);
  });

  it("rejects truncated input", () => {
    const w = new ByteWriter();
    w.str("hello");
    const bytes = w.finish().subarray(0, 3);
    const r = new ByteReader(bytes);
    expect(() => r.str()).toThrow(ZbDecodeError);
  });

  it("works when the buffer is an offset view (Node Buffer slice)", () => {
    const w = new ByteWriter();
    w.f64(123.456);
    const raw = w.finish();
    const padded = new Uint8Array(raw.length + 4);
    padded.set(raw, 4);
    const view = padded.subarray(4);
    expect(new ByteReader(view).f64()).toBe(123.456);
  });
});

describe("object codec", () => {
  const Schema = zb.object({
    kind: zb.literal("thing"),
    id: zb.uint(),
    name: zb.string({ min: 1 }),
    ratio: zb.float(),
    active: z.boolean(),
    maybe: z.boolean().optional(),
    tag: zb.string().nullable(),
    both: zb.uint().nullable().optional(),
    paused: z.boolean().default(false),
  });

  it("round-trips a fully populated value", () => {
    const v = {
      kind: "thing" as const,
      id: 42,
      name: "abc",
      ratio: 0.25,
      active: true,
      maybe: false,
      tag: null,
      both: 7,
      paused: true,
    };
    expect(Schema.parseBytes(Schema.serialize(v))).toEqual(v);
  });

  it("round-trips absent optionals and applies defaults", () => {
    const v = {
      kind: "thing" as const,
      id: 0,
      name: "x",
      ratio: -1.5,
      active: false,
      tag: "t",
    };
    const out = Schema.parseBytes(Schema.serialize(v));
    expect(out).toEqual({ ...v, paused: false });
    expect("maybe" in out).toBe(false);
    expect("both" in out).toBe(false);
  });

  it("matches the JSON round-trip exactly", () => {
    const v = {
      kind: "thing" as const,
      id: 9,
      name: "abc",
      ratio: 1 / 3,
      active: true,
      tag: null,
      both: null,
    };
    const viaJson = Schema.parse(JSON.parse(JSON.stringify(v)));
    const viaBytes = Schema.parseBytes(Schema.serialize(v));
    expect(viaBytes).toEqual(viaJson);
  });

  it("literal fields cost zero bytes", () => {
    const A = zb.object({
      t: zb.literal("a-very-long-type-tag"),
      n: zb.uint(),
    });
    expect(A.serialize({ t: "a-very-long-type-tag", n: 5 }).length).toBe(1);
  });

  it("throws on missing required fields at encode time", () => {
    expect(() => Schema.serialize({ kind: "thing" } as any)).toThrow(
      ZbEncodeError,
    );
  });

  it("rejects trailing bytes", () => {
    const A = zb.object({ n: zb.uint() });
    const bytes = A.serialize({ n: 1 });
    const padded = new Uint8Array([...bytes, 0]);
    expect(() => A.parseBytes(padded)).toThrow(ZbDecodeError);
  });

  it("packs many flag fields into a compact header", () => {
    const Flags = zb.object({
      a: z.boolean(),
      b: z.boolean(),
      c: z.boolean(),
      d: z.boolean(),
      e: z.boolean(),
      f: z.boolean(),
      g: z.boolean(),
      h: z.boolean(),
    });
    const v = {
      a: true,
      b: false,
      c: true,
      d: true,
      e: false,
      f: false,
      g: true,
      h: true,
    };
    const bytes = Flags.serialize(v);
    expect(bytes.length).toBe(1);
    expect(Flags.parseBytes(bytes)).toEqual(v);
  });
});

describe("containers and unions", () => {
  it("auto-derives nested plain-zod objects, arrays, enums, records", () => {
    const S = zb.object({
      items: z.array(z.object({ name: z.string(), size: zb.uint() })),
      mode: z.enum(["slow", "fast"]),
      counts: z.record(z.string(), zb.uint()),
      partial: z.partialRecord(z.enum(["x", "y"]), zb.uint()),
    });
    const v = {
      items: [
        { name: "a", size: 1 },
        { name: "b", size: 2 },
      ],
      mode: "fast" as const,
      counts: { k1: 5, k2: 6 },
      partial: { y: 9 },
    };
    expect(S.parseBytes(S.serialize(v))).toEqual(v);
  });

  it("encodes enum record keys as ordinals", () => {
    const S = zb.object({
      m: z.partialRecord(z.enum(["longkeyname1", "longkeyname2"]), zb.uint()),
    });
    const bytes = S.serialize({ m: { longkeyname1: 1, longkeyname2: 2 } });
    // count(1) + 2 * (ordinal(1) + value(1)) = 5
    expect(bytes.length).toBe(5);
  });

  it("round-trips discriminated unions with zero-cost tags", () => {
    const U = zb.discriminatedUnion("type", [
      z.object({ type: z.literal("ping") }),
      z.object({ type: z.literal("move"), x: zb.uint(), y: zb.uint() }),
    ]);
    expect(U.parseBytes(U.serialize({ type: "ping" }))).toEqual({
      type: "ping",
    });
    expect(U.parseBytes(U.serialize({ type: "move", x: 3, y: 4 }))).toEqual({
      type: "move",
      x: 3,
      y: 4,
    });
    expect(U.serialize({ type: "ping" }).length).toBe(1);
  });

  it("round-trips untagged unions via synthetic tags", () => {
    const U = zb.union([
      zb.string({ regex: /^[A-Za-z0-9]{8}$/ }),
      zb.literal("AllPlayers"),
    ]);
    expect(U.parseBytes(U.serialize("abcd1234"))).toBe("abcd1234");
    expect(U.parseBytes(U.serialize("AllPlayers"))).toBe("AllPlayers");
  });

  it("round-trips tuples with rest elements", () => {
    const W = zb.object({
      winner: z
        .tuple([z.literal("team"), z.string()])
        .rest(zb.string())
        .optional(),
    });
    const v = { winner: ["team", "Red", "id1", "id2"] };

    expect(W.parseBytes(W.serialize(v as any))).toEqual(v);
    expect(W.parseBytes(W.serialize({}))).toEqual({});
  });

  it("resolves z.lazy schemas", () => {
    const Inner = zb.object({ n: zb.uint() });
    const S = zb.object({ inner: z.lazy(() => Inner).optional() });
    const v = { inner: { n: 3 } };
    expect(S.parseBytes(S.serialize(v))).toEqual(v);
  });

  it("supports standalone optional/nullable inside arrays", () => {
    const S = zb.object({ xs: z.array(zb.uint().nullable()) });
    const v = { xs: [1, null, 3] };
    expect(S.parseBytes(S.serialize(v))).toEqual(v);
  });

  it("rejects plain z.number() with a helpful error", () => {
    expect(() => zb.object({ n: z.number() })).toThrow(/zb\.uint/);
  });

  it("rejects out-of-range union tags on decode", () => {
    const U = zb.discriminatedUnion("type", [
      z.object({ type: z.literal("a") }),
    ]);
    expect(() => U.parseBytes(new Uint8Array([9]))).toThrow(ZbDecodeError);
  });
});

describe("json escape hatch", () => {
  it("round-trips complex subtrees as embedded JSON", () => {
    const Config = z.object({
      gameMap: z.string(),
      bots: z.number(),
      nested: z.object({ a: z.boolean() }).optional(),
    });
    const S = zb.object({ config: zb.json(Config.partial()) });
    const v = { config: { gameMap: "Asia", nested: { a: true } } };
    expect(S.parseBytes(S.serialize(v))).toEqual(v);
  });
});

describe("mapped strings and context", () => {
  const S = zb.object({
    from: zb.mapped("clientId", { regex: /^[A-Za-z0-9]{8}$/ }),
    to: zb.mapped("clientId", { regex: /^[A-Za-z0-9]{8}$/ }).nullable(),
  });

  function makeCtx() {
    const ctx = zb.context();
    ctx.mapping("clientId", { max: 125 });
    ctx.assignAll("clientId", ["aaaaaaaa", "bbbbbbbb"]);
    return ctx;
  }

  it("encodes mapped ids as one byte", () => {
    const ctx = makeCtx();
    const bytes = S.serialize({ from: "aaaaaaaa", to: "bbbbbbbb" }, ctx);
    // header(1: null-bit for `to`) + from(1) + to(1)
    expect(bytes.length).toBe(3);
    expect(S.parseBytes(bytes, ctx)).toEqual({
      from: "aaaaaaaa",
      to: "bbbbbbbb",
    });
  });

  it("escapes unmapped values inline", () => {
    const ctx = makeCtx();
    const v = { from: "ADMINBOT", to: null };
    const bytes = S.serialize(v, ctx);
    expect(S.parseBytes(bytes, ctx)).toEqual(v);
  });

  it("works without any context (all inline)", () => {
    const v = { from: "cccccccc", to: "dddddddd" };
    expect(S.parseBytes(S.serialize(v))).toEqual(v);
  });

  it("decoding an index without the table is a protocol error", () => {
    const ctx = makeCtx();
    const bytes = S.serialize({ from: "aaaaaaaa", to: null }, ctx);
    expect(() => S.parseBytes(bytes)).toThrow(ZbDecodeError);
  });

  it("identical assign order on both sides stays in sync", () => {
    const a = makeCtx();
    const b = makeCtx();
    const bytes = S.serialize({ from: "bbbbbbbb", to: "aaaaaaaa" }, a);
    expect(S.parseBytes(bytes, b)).toEqual({
      from: "bbbbbbbb",
      to: "aaaaaaaa",
    });
  });

  it("overflows past max fall back to inline encoding", () => {
    const ctx = zb.context();
    ctx.mapping("clientId", { max: 1 });
    expect(ctx.assign("clientId", "aaaaaaaa")).toBe(0);
    expect(ctx.assign("clientId", "bbbbbbbb")).toBe(-1);
    const v = { from: "bbbbbbbb", to: null };
    expect(S.parseBytes(S.serialize(v, ctx), ctx)).toEqual(v);
  });
});

describe("stamped (intersection over discriminated union)", () => {
  const Union = z.discriminatedUnion("type", [
    z.object({ type: z.literal("attack"), troops: zb.float().nullable() }),
    z.object({ type: z.literal("spawn"), tile: zb.uint() }),
  ]);
  const Stamped = zb.stamped(Union, {
    clientID: zb.mapped("clientId", { regex: /^[A-Za-z0-9]{8}$/ }),
  });

  it("round-trips and matches the zod intersection", () => {
    const v = { type: "attack" as const, troops: 512.5, clientID: "aaaaaaaa" };
    const out = Stamped.parseBytes(Stamped.serialize(v));
    expect(out).toEqual(v);
    expect(Stamped.safeParse(out).success).toBe(true);
  });

  it("is compact with a context", () => {
    const ctx = zb.context();
    ctx.mapping("clientId", { max: 125 });
    ctx.assign("clientId", "aaaaaaaa");
    const v = { type: "spawn" as const, tile: 123456, clientID: "aaaaaaaa" };
    const bytes = Stamped.serialize(v, ctx);
    // tag(1) + clientID(1) + tile varint(3)
    expect(bytes.length).toBe(5);
    expect(Stamped.parseBytes(bytes, ctx)).toEqual(v);
  });
});

describe("fuzz: random values survive serialize→parseBytes", () => {
  const Fuzz = zb.object({
    id: zb.uint(),
    delta: zb.int(),
    ratio: zb.float(),
    name: zb.string(),
    flags: z.array(z.boolean()),
    kind: z.enum(["a", "b", "c"]),
    opt: zb.uint().optional(),
    nul: zb.string().nullable(),
  });

  it("1000 random values", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 1000; i++) {
      const v = {
        id: Math.floor(rand() * 2 ** 50),
        delta: Math.floor((rand() - 0.5) * 2 ** 40),
        ratio: (rand() - 0.5) * 10 ** (rand() * 20),
        name: "x".repeat(Math.floor(rand() * 50)),
        flags: Array.from({ length: Math.floor(rand() * 10) }, () =>
          rand() > 0.5 ? true : false,
        ),
        kind: (["a", "b", "c"] as const)[Math.floor(rand() * 3)],
        ...(rand() > 0.5 ? { opt: Math.floor(rand() * 1000) } : {}),
        nul: rand() > 0.5 ? "s" : null,
      };
      expect(Fuzz.parseBytes(Fuzz.serialize(v))).toEqual(v);
    }
  });
});

describe("edge cases", () => {
  it("spills header bits into a second byte past 8 flags", () => {
    const S = zb.object({
      a: z.boolean(),
      b: z.boolean(),
      c: z.boolean(),
      d: z.boolean(),
      e: z.boolean(),
      f: z.boolean().optional(), // 2 bits
      g: zb.uint().optional(), // 1 bit
      h: zb.string().nullable(), // 1 bit
      i: z.boolean(), // 10th bit -> byte 2
    });
    const v = {
      a: true,
      b: false,
      c: true,
      d: false,
      e: true,
      f: true,
      g: 7,
      h: null,
      i: true,
    };
    const bytes = S.serialize(v);
    // 2 header bytes + varint g
    expect(bytes.length).toBe(3);
    expect(S.parseBytes(bytes)).toEqual(v);
  });

  it("round-trips an empty object as zero bytes", () => {
    const S = zb.object({});
    const bytes = S.serialize({});
    expect(bytes.length).toBe(0);
    expect(S.parseBytes(bytes)).toEqual({});
  });

  it("round-trips NaN and infinities through zb.float", () => {
    const S = zb.object({ f: zb.float() });
    expect(S.decodeBytesUnvalidated(S.serialize({ f: Infinity })).f).toBe(
      Infinity,
    );
    expect(S.decodeBytesUnvalidated(S.serialize({ f: -Infinity })).f).toBe(
      -Infinity,
    );
    expect(
      Number.isNaN(S.decodeBytesUnvalidated(S.serialize({ f: NaN })).f),
    ).toBe(true);
  });

  it("supports multi-value z.literal as an implicit enum", () => {
    const S = zb.object({ v: z.literal(["one", "two"]) });
    expect(S.serialize({ v: "two" }).length).toBe(1);
    expect(S.parseBytes(S.serialize({ v: "two" }))).toEqual({ v: "two" });
  });

  it("applies standalone defaults inside array elements", () => {
    const S = zb.object({ xs: z.array(z.boolean().default(true)) });
    const v = { xs: [false, true] };
    expect(S.parseBytes(S.serialize(v))).toEqual(v);
  });

  it("reuses a zb root schema as a field of another zb schema", () => {
    const Inner = zb.object({ n: zb.uint() });
    const Outer = zb.object({ inner: Inner, list: Inner.array() });
    const v = { inner: { n: 1 }, list: [{ n: 2 }, { n: 3 }] };
    expect(Outer.parseBytes(Outer.serialize(v))).toEqual(v);
  });

  it("zb.custom installs a hand-written codec", () => {
    // Pack an 8-char lowercase id into 5 bytes via a custom codec.
    const codec = {
      enc: (w: ByteWriter, v: string) => {
        let n = 0;
        for (const ch of v) n = n * 26 + (ch.charCodeAt(0) - 97);
        w.uint(n);
      },
      dec: (r: ByteReader) => {
        let n = r.uint();
        const out: string[] = [];
        for (let i = 0; i < 8; i++) {
          out.unshift(String.fromCharCode(97 + (n % 26)));
          n = Math.floor(n / 26);
        }
        return out.join("");
      },
    };
    const S = zb.object({
      id: zb.custom(z.string().regex(/^[a-z]{8}$/), codec),
    });
    const bytes = S.serialize({ id: "abcdwxyz" });
    expect(bytes.length).toBeLessThanOrEqual(6);
    expect(S.parseBytes(bytes)).toEqual({ id: "abcdwxyz" });
  });
});

describe("context contract", () => {
  it("handles a full 255-entry table and escapes the 256th value", () => {
    const S = zb.object({ id: zb.mapped("m") });
    const values = Array.from(
      { length: 256 },
      (_, i) => `v${String(i).padStart(6, "0")}`,
    );
    const ctx = zb.context();
    ctx.mapping("m"); // default max = 255
    for (let i = 0; i < 255; i++) expect(ctx.assign("m", values[i])).toBe(i);
    expect(ctx.assign("m", values[255])).toBe(-1); // full -> unmapped
    // Boundary index 254 encodes as one byte; overflow value goes inline.
    expect(S.serialize({ id: values[254] }, ctx).length).toBe(1);
    expect(S.serialize({ id: values[255] }, ctx).length).toBeGreaterThan(1);
    const rctx = zb.context();
    rctx.mapping("m");
    rctx.assignAll("m", values);
    for (const id of [values[0], values[254], values[255]]) {
      expect(S.parseBytes(S.serialize({ id }, ctx), rctx)).toEqual({ id });
    }
  });

  it("rejects invalid mapping declarations", () => {
    const ctx = zb.context();
    expect(() => ctx.mapping("m", { max: 0 })).toThrow(RangeError);
    expect(() => ctx.mapping("m", { max: 256 })).toThrow(RangeError);
    expect(() => ctx.mapping("m", { max: 1.5 })).toThrow(RangeError);
    ctx.mapping("m", { max: 10 });
    expect(() => ctx.mapping("m", { max: 10 })).toThrow(/already declared/);
  });

  it("rejects assigning to an undeclared mapping", () => {
    const ctx = zb.context();
    expect(() => ctx.assign("nope", "v")).toThrow(/not declared/);
  });

  it("assigning an existing value returns its original index", () => {
    const ctx = zb.context();
    ctx.mapping("m", { max: 5 });
    expect(ctx.assign("m", "a")).toBe(0);
    expect(ctx.assign("m", "b")).toBe(1);
    expect(ctx.assign("m", "a")).toBe(0);
    expect(ctx.size("m")).toBe(2);
  });
});
