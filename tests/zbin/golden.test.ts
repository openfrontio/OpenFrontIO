// Golden wire vectors.
//
// Every other test round-trips through the same encoder and decoder, so none
// of them can observe the wire format itself: reversing field order, changing
// the presence-bit packing, or re-basing the varint encoding all stay green
// as long as both directions change together. These hex vectors are the only
// thing pinning the layout.
//
// A failure here means the wire format changed. Since zbin has no version byte
// and peers are expected to run the same build, that is fine to do
// deliberately — update the vector — but it must never happen by accident.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PublicGameInfoSchema } from "../../src/core/Schemas";
import { zb } from "../../zbin";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("golden wire vectors", () => {
  it("presence header packs optional, null, and bool bits LSB-first", () => {
    const S = zb.object({
      a: z.boolean(), // valueBit 0
      b: zb.uint(), // no bits
      c: zb.string().nullable(), // nullBit 1
      d: zb.uint().optional(), // presenceBit 2
    });
    // a=true -> bit0; c=null -> bit1; d absent -> bit2 clear. header = 0b011.
    expect(hex(S.serialize({ a: true, b: 300, c: null }))).toBe("03ac02");
    // a=false, c="hi", d=7 -> header = 0b100 (only presenceBit set).
    expect(hex(S.serialize({ a: false, b: 1, c: "hi", d: 7 }))).toBe(
      "040102686907",
    );
  });

  it("varints are unsigned LEB128 and signed values are zigzagged", () => {
    const U = zb.object({ n: zb.uint() });
    expect(hex(U.serialize({ n: 0 }))).toBe("00");
    expect(hex(U.serialize({ n: 127 }))).toBe("7f");
    expect(hex(U.serialize({ n: 128 }))).toBe("8001");
    expect(hex(U.serialize({ n: 16384 }))).toBe("808001");

    const I = zb.object({ n: zb.int() });
    expect(hex(I.serialize({ n: 0 }))).toBe("00");
    expect(hex(I.serialize({ n: -1 }))).toBe("01");
    expect(hex(I.serialize({ n: 1 }))).toBe("02");
    expect(hex(I.serialize({ n: -64 }))).toBe("7f");
  });

  it("enum and union ordinals follow declaration order", () => {
    const E = zb.object({ e: z.enum(["red", "green", "blue"]) });
    expect(hex(E.serialize({ e: "red" }))).toBe("00");
    expect(hex(E.serialize({ e: "blue" }))).toBe("02");

    const DU = zb.discriminatedUnion("t", [
      z.object({ t: z.literal("move"), x: zb.uint() }),
      z.object({ t: z.literal("nuke"), x: zb.uint() }),
    ]);
    expect(hex(DU.serialize({ t: "move", x: 5 }))).toBe("0005");
    expect(hex(DU.serialize({ t: "nuke", x: 5 }))).toBe("0105");
  });

  it("literals cost zero bytes and eight booleans cost one", () => {
    const L = zb.object({ tag: z.literal("spawn"), n: zb.uint() });
    expect(hex(L.serialize({ tag: "spawn", n: 9 }))).toBe("09");

    const shape: Record<string, z.ZodBoolean> = {};
    for (let i = 0; i < 8; i++) shape[`b${i}`] = z.boolean();
    const B = zb.object(shape);
    const allTrue = Object.fromEntries(
      Object.keys(shape).map((k) => [k, true]),
    );
    expect(hex(B.serialize(allTrue))).toBe("ff");
  });

  it("a multi-byte presence header spills into a second byte", () => {
    const shape: Record<string, z.ZodOptional<z.ZodBoolean>> = {};
    // Each field takes a presence bit AND a value bit -> 20 bits, 3 bytes.
    for (let i = 0; i < 10; i++) shape[`b${i}`] = z.boolean().optional();
    const S = zb.object(shape);
    const bytes = S.serialize({ b0: true, b9: true });
    expect(bytes.length).toBe(3);
    // b0: presenceBit 0, valueBit 1. b9: presenceBit 18, valueBit 19.
    expect(hex(bytes)).toBe("03000c");
  });

  it("float64 is little-endian and bit-exact", () => {
    const F = zb.object({ f: zb.float() });
    expect(hex(F.serialize({ f: 1 }))).toBe("000000000000f03f");
    expect(hex(F.serialize({ f: -0 }))).toBe("0000000000000080");
  });

  it("strings are a length varint followed by UTF-8", () => {
    const S = zb.object({ s: zb.string() });
    expect(hex(S.serialize({ s: "" }))).toBe("00");
    expect(hex(S.serialize({ s: "hi" }))).toBe("026869");
    expect(hex(S.serialize({ s: "ü" }))).toBe("02c3bc");
    expect(hex(S.serialize({ s: "🎉" }))).toBe("04f09f8e89");
  });

  it("mapped ids are varint(index+1), with varint 0 escaping inline", () => {
    const S = zb.object({ id: zb.mapped("ids") });
    const ctx = zb.context().mapping("ids").assignAll("ids", ["aa", "bb"]);
    expect(hex(S.serialize({ id: "aa" }, ctx))).toBe("01");
    expect(hex(S.serialize({ id: "bb" }, ctx))).toBe("02");
    expect(hex(S.serialize({ id: "zz" }, ctx))).toBe("00027a7a");
  });

  it("zb.stamped writes tag, then extras, then variant fields", () => {
    const U = z.discriminatedUnion("t", [
      z.object({ t: z.literal("a"), x: zb.uint() }),
      z.object({ t: z.literal("b"), y: zb.uint() }),
    ]);
    const S = zb.stamped(U, { cid: zb.uint() });
    // tag=1, extras cid=7, variant y=9
    expect(hex(S.serialize({ t: "b", y: 9, cid: 7 }))).toBe("010709");
  });

  it("arrays and records are a count varint followed by elements", () => {
    const A = zb.object({ xs: z.array(zb.uint()) });
    expect(hex(A.serialize({ xs: [] }))).toBe("00");
    expect(hex(A.serialize({ xs: [1, 2, 3] }))).toBe("03010203");

    const R = zb.object({ m: z.record(z.string(), zb.uint()) });
    expect(hex(R.serialize({ m: { a: 1 } }))).toBe("01016101");
  });

  // Not a compatibility guarantee: zbin has no version byte or field tags, so an
  // old decoder has no way to know a trailing field is there and skips straight
  // into the next array element's bytes. Appending only keeps the *existing*
  // fields' bits and offsets where they were, which is what this pins — the
  // lobby list is a long-lived payload and reordering it is easy to do by
  // accident.
  it("PublicGameInfo keeps its field order and presence bits", () => {
    const S = zb.object({ info: PublicGameInfoSchema });
    const lobby = {
      gameID: "abcd1234",
      numClients: 3,
      publicGameType: "ffa" as const,
    };
    // header 0x00: nothing optional present. Then gameID (len 8 + bytes),
    // numClients, and the publicGameType ordinal.
    expect(hex(S.serialize({ info: lobby }))).toBe("000861626364313233340300");
    // queuePosition is presence bit 6 and the last value on the wire.
    expect(hex(S.serialize({ info: { ...lobby, queuePosition: 5 } }))).toBe(
      "40086162636431323334030005",
    );
    // startsAt is bit 0, and its value still comes before queuePosition's.
    expect(
      hex(S.serialize({ info: { ...lobby, startsAt: 1, queuePosition: 0 } })),
    ).toBe("4108616263643132333403010000");
  });
});
