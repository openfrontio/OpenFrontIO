// Property-based and adversarial testing.
//
// 1. Generative round-trips: thousands of random values over a composite
//    schema exercising every codec — decode(encode(v)) must deep-equal v and
//    match zod's own JSON round-trip.
// 2. Adversarial decode: random bytes and bit-mutated valid payloads must
//    either decode cleanly or throw ZbDecodeError/ZodError — never anything
//    else, never hang, never crash.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zb, ZbDecodeError } from "../../zbin";

// Deterministic PRNG so failures reproduce.
function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x80000000;
  };
}

const KINDS = ["alpha", "beta", "gamma"] as const;

const ItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("num"),
    u: zb.uint(),
    i: zb.int(),
    f: zb.float(),
  }),
  z.object({ type: z.literal("txt"), s: zb.string(), id: zb.mapped("ids") }),
  z.object({
    type: z.literal("mix"),
    flags: z.array(z.boolean()),
    kind: z.enum(KINDS),
    opt: zb.uint().optional(),
    nul: zb.string().nullable(),
    both: zb.float().nullable().optional(),
    dflt: z.boolean().default(true),
  }),
]);

const FuzzSchema = zb.object({
  header: zb.literal("fuzz"),
  seq: zb.uint(),
  big: zb.bigint(),
  items: ItemSchema.array(),
  tags: z.record(z.string(), zb.uint()),
  partial: z.partialRecord(z.enum(KINDS), zb.int()),
  blob: zb.json(z.object({ any: z.string().optional() })),
  maybeList: z.array(zb.uint().nullable()).optional(),
});
// Input shape: defaulted fields may be absent (the generator omits them
// sometimes on purpose — parse/decode must fill them identically).
type Fuzz = zb.input<typeof FuzzSchema>;

const IDS = ["idAAAAAA", "idBBBBBB", "idCCCCCC"];

function makeCtx() {
  const ctx = zb.context();
  ctx.mapping("ids", { max: 100 });
  ctx.assignAll("ids", IDS);
  return ctx;
}

function randomValue(rand: () => number): Fuzz {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const maybe = <T>(v: T): T | undefined => (rand() > 0.5 ? v : undefined);
  const str = () =>
    Array.from({ length: Math.floor(rand() * 20) }, () =>
      pick(["a", "b", "Z", "9", "ü", "🎉", " "]),
    ).join("");
  const items = Array.from({ length: Math.floor(rand() * 8) }, () => {
    switch (Math.floor(rand() * 3)) {
      case 0:
        return {
          type: "num" as const,
          u: Math.floor(rand() * 2 ** 50),
          i: Math.floor((rand() - 0.5) * 2 ** 40),
          f: (rand() - 0.5) * 10 ** Math.floor(rand() * 30),
        };
      case 1:
        return {
          type: "txt" as const,
          s: str(),
          // Mix of mapped ids and escape-path strangers.
          id: rand() > 0.3 ? pick(IDS) : `x${str()}`,
        };
      default:
        return {
          type: "mix" as const,
          flags: Array.from({ length: Math.floor(rand() * 12) }, () =>
            rand() > 0.5 ? true : false,
          ),
          kind: pick(KINDS),
          ...(rand() > 0.5 ? { opt: Math.floor(rand() * 1000) } : {}),
          nul: rand() > 0.5 ? str() : null,
          ...(rand() > 0.66
            ? { both: rand() > 0.5 ? rand() * 100 : null }
            : {}),
          ...(rand() > 0.5 ? { dflt: rand() > 0.5 } : {}),
        };
    }
  });
  const tags: Record<string, number> = {};
  for (let i = Math.floor(rand() * 5); i > 0; i--) {
    tags[`k${i}${str()}`] = Math.floor(rand() * 10000);
  }
  const partial: Partial<Record<(typeof KINDS)[number], number>> = {};
  for (const k of KINDS) {
    if (rand() > 0.5) partial[k] = Math.floor((rand() - 0.5) * 1000);
  }
  return {
    header: "fuzz",
    seq: Math.floor(rand() * Number.MAX_SAFE_INTEGER),
    big: BigInt(Math.floor((rand() - 0.5) * 2 ** 50)) * 2n ** 40n,
    items,
    tags,
    partial,
    blob: rand() > 0.5 ? { any: str() } : {},
    maybeList: maybe(
      Array.from({ length: Math.floor(rand() * 5) }, () =>
        rand() > 0.3 ? Math.floor(rand() * 100) : null,
      ),
    ),
  };
}

describe("generative round-trips", () => {
  it("2000 random values survive serialize→parseBytes exactly", () => {
    const rand = makeRand(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const v = randomValue(rand);
      const sctx = makeCtx();
      const rctx = makeCtx();
      const out = FuzzSchema.parseBytes(FuzzSchema.serialize(v, sctx), rctx);
      expect(out).toEqual(FuzzSchema.parse(v));
    }
  });

  it("agrees with the zod JSON path on 500 bigint-free values", () => {
    // JSON.stringify can't carry bigint, so compare on a bigint-free slice.
    const JsonSafe = zb.object({
      header: zb.literal("fuzz"),
      seq: zb.uint(),
      items: ItemSchema.array(),
      tags: z.record(z.string(), zb.uint()),
    });
    const rand = makeRand(0xbeef);
    for (let i = 0; i < 500; i++) {
      const { header, seq, items, tags } = randomValue(rand);
      const v = { header, seq, items, tags };
      const viaJson = JsonSafe.parse(JSON.parse(JSON.stringify(v)));
      const viaBin = JsonSafe.parseBytes(
        JsonSafe.serialize(v, makeCtx()),
        makeCtx(),
      );
      expect(viaBin).toEqual(viaJson);
    }
  });

  it("double round-trip is byte-stable (encode∘decode∘encode = encode)", () => {
    // Compare on zod-normalized values: parse applies defaults, so a raw
    // input with an absent defaulted field legitimately re-encodes with its
    // presence bit set. After one normalization the bytes must be stable.
    const rand = makeRand(0x5eed);
    for (let i = 0; i < 200; i++) {
      const v = FuzzSchema.parse(randomValue(rand));
      const a = FuzzSchema.serialize(v, makeCtx());
      const back = FuzzSchema.parseBytes(a, makeCtx());
      const b = FuzzSchema.serialize(back, makeCtx());
      expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    }
  });
});

describe("adversarial decode", () => {
  const isAcceptable = (e: unknown) =>
    e instanceof ZbDecodeError || e instanceof z.ZodError;

  it("5000 random byte strings never crash the decoder", () => {
    const rand = makeRand(0xdead);
    for (let i = 0; i < 5000; i++) {
      const bytes = new Uint8Array(
        Array.from({ length: Math.floor(rand() * 64) }, () =>
          Math.floor(rand() * 256),
        ),
      );
      try {
        FuzzSchema.parseBytes(bytes, makeCtx());
      } catch (e) {
        if (!isAcceptable(e)) throw e;
      }
    }
  });

  it("bit-flipped valid payloads fail cleanly or decode to something valid", () => {
    const rand = makeRand(0xf1a6);
    const v = randomValue(rand);
    const bytes = FuzzSchema.serialize(v, makeCtx());
    for (let i = 0; i < 1000; i++) {
      const mutated = bytes.slice();
      const flips = 1 + Math.floor(rand() * 4);
      for (let f = 0; f < flips; f++) {
        const at = Math.floor(rand() * mutated.length);
        mutated[at] ^= 1 << Math.floor(rand() * 8);
      }
      try {
        // If it decodes, it must be schema-valid — parseBytes guarantees it.
        FuzzSchema.parseBytes(mutated, makeCtx());
      } catch (e) {
        if (!isAcceptable(e)) throw e;
      }
    }
  });

  it("appended trailing bytes always fail", () => {
    const v = randomValue(makeRand(1));
    const bytes = FuzzSchema.serialize(v, makeCtx());
    const padded = new Uint8Array([...bytes, 0]);
    expect(() => FuzzSchema.parseBytes(padded, makeCtx())).toThrow(
      ZbDecodeError,
    );
  });

  it("corrupt embedded JSON throws ZbDecodeError, not SyntaxError", () => {
    const S = zb.object({ blob: zb.json(z.object({ a: z.string() })) });
    const bytes = S.serialize({ blob: { a: "x" } });
    // The JSON payload starts after the object header (0 bytes here, no
    // optional fields) + string length varint; corrupt its first brace.
    bytes[1] = 0x21; // '{' -> '!'
    expect(() => S.parseBytes(bytes)).toThrow(ZbDecodeError);
  });
});
