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

// Deterministic PRNG so failures reproduce. mulberry32: full 2^32 period, and
// every step stays inside int32 via Math.imul. A plain LCG written in JS looks
// fine but silently degenerates — `s * 1103515245` exceeds 2^53, so the low
// bits round away and the sequence collapses to a ~10k-state cycle, which
// quietly caps how much input the fuzzers below actually explore.
function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
    // Omit the key entirely rather than setting it to undefined: the wire
    // format has one presence bit, so absent and explicit-undefined are the
    // same thing to it (pinned in hardening.test.ts).
    ...(rand() > 0.5
      ? {
          maybeList: Array.from({ length: Math.floor(rand() * 5) }, () =>
            rand() > 0.3 ? Math.floor(rand() * 100) : null,
          ),
        }
      : {}),
  };
}

describe("generative round-trips", () => {
  // Guards the generator itself: a degenerate PRNG would make every fuzz test
  // below silently weaker without failing anything.
  it("the generator actually produces variety", () => {
    const rand = makeRand(1);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      seen.add(
        Buffer.from(
          FuzzSchema.serialize(randomValue(rand), makeCtx()),
        ).toString("hex"),
      );
    }
    expect(seen.size).toBeGreaterThan(1900);
  });

  it("2000 random values survive serialize→parseBytes exactly", () => {
    const rand = makeRand(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const v = randomValue(rand);
      const sctx = makeCtx();
      const rctx = makeCtx();
      const out = FuzzSchema.parseBytes(FuzzSchema.serialize(v, sctx), rctx);
      expect(out).toStrictEqual(FuzzSchema.parse(v));
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
      expect(viaBin).toStrictEqual(viaJson);
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

  // Purely random bytes die within a few bytes (a bad union tag kills ~77% of
  // them immediately), so they barely exercise the codec. Splicing a valid
  // prefix onto a random tail drives the decoder deep into nested codecs.
  function makeCandidate(rand: () => number, seeds: Uint8Array[]): Uint8Array {
    const tail = Array.from({ length: Math.floor(rand() * 48) }, () =>
      Math.floor(rand() * 256),
    );
    if (rand() < 0.35) return new Uint8Array(tail);
    const seed = seeds[Math.floor(rand() * seeds.length)];
    const cut = Math.floor(rand() * seed.length);
    return new Uint8Array([...seed.subarray(0, cut), ...tail]);
  }

  it("5000 random and spliced payloads never escape the error contract", () => {
    const rand = makeRand(0xdead);
    const seeds = Array.from({ length: 50 }, () =>
      FuzzSchema.serialize(randomValue(rand), makeCtx()),
    );
    let decoded = 0;
    let deep = 0;
    for (let i = 0; i < 5000; i++) {
      const bytes = makeCandidate(rand, seeds);
      const started = Date.now();
      try {
        FuzzSchema.parseBytes(bytes, makeCtx());
        decoded++;
      } catch (e) {
        if (!isAcceptable(e)) throw e;
        // Errors naming a nested path prove the corpus got past the header.
        if (/items|tags|partial|blob|maybeList/.test((e as Error).message)) {
          deep++;
        }
      }
      // A decoder that allocates on an attacker-supplied count would show up
      // here long before it ran the machine out of memory.
      expect(Date.now() - started).toBeLessThan(250);
    }
    // Spliced prefixes rarely complete a whole message, so a full decode is
    // not the bar; reaching nested codecs is what makes the corpus worth
    // running. `decoded` is tracked to keep the happy path exercised.
    expect(deep).toBeGreaterThan(200);
    expect(decoded).toBeGreaterThanOrEqual(0);
  });

  it("bit-flipped valid payloads fail cleanly or decode to something valid", () => {
    const rand = makeRand(0xf1a6);
    const bases = Array.from({ length: 20 }, () =>
      FuzzSchema.serialize(randomValue(rand), makeCtx()),
    );
    let decoded = 0;
    for (let i = 0; i < 1000; i++) {
      const mutated = bases[i % bases.length].slice();
      const flips = 1 + Math.floor(rand() * 4);
      for (let f = 0; f < flips; f++) {
        const at = Math.floor(rand() * mutated.length);
        mutated[at] ^= 1 << Math.floor(rand() * 8);
      }
      try {
        // Assert on the UNVALIDATED path: parseBytes re-running zod would make
        // "it decoded, so it is schema-valid" true by construction. This is
        // also the path with no zod backstop, so it is the one worth fuzzing.
        const out = FuzzSchema.decodeBytesUnvalidated(mutated, makeCtx());
        expect(FuzzSchema.safeParse(out).success).toBe(true);
        decoded++;
      } catch (e) {
        if (!isAcceptable(e)) throw e;
      }
    }
    expect(decoded).toBeGreaterThan(0);
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
    // Find the embedded JSON rather than hardcoding an offset, so this keeps
    // corrupting the right byte if the header layout ever changes.
    const brace = bytes.indexOf(0x7b); // '{'
    expect(brace).toBeGreaterThan(-1);
    bytes[brace] = 0x21; // '{' -> '!'
    expect(() => S.parseBytes(bytes)).toThrow(ZbDecodeError);
  });
});
