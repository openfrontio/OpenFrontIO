import { BinaryReader } from "../../../../src/client/replay/codec/BinaryReader";
import { BinaryWriter } from "../../../../src/client/replay/codec/BinaryWriter";

function written(write: (w: BinaryWriter) => void): Uint8Array {
  const w = new BinaryWriter(16);
  write(w);
  return w.finish();
}

describe("varints", () => {
  test.each([
    [0, 1],
    [127, 1],
    [128, 2],
    [16_383, 2],
    [16_384, 3],
    [2 ** 32 - 1, 5],
    [Number.MAX_SAFE_INTEGER, 8],
  ])("varuint %d round-trips in %d bytes", (v, size) => {
    const bytes = written((w) => w.writeVarUint(v));
    expect(bytes.length).toBe(size);
    const r = new BinaryReader(bytes);
    expect(r.readVarUint()).toBe(v);
    expect(r.offset).toBe(size);
  });

  test.each([0, -1, 1, -64, 63, -65, 64, -(2 ** 40), 2 ** 51, -(2 ** 51)])(
    "varint %d round-trips; small magnitudes stay small",
    (v) => {
      const bytes = written((w) => w.writeVarInt(v));
      if (Math.abs(v) <= 63) expect(bytes.length).toBe(1);
      expect(new BinaryReader(bytes).readVarInt()).toBe(v);
    },
  );

  test("consecutive varints don't bleed into each other", () => {
    const vals = [300, 0, 5, 2 ** 40, 1];
    const r = new BinaryReader(
      written((w) => vals.forEach((v) => w.writeVarUint(v))),
    );
    expect(vals.map(() => r.readVarUint())).toEqual(vals);
  });

  test("rejects values it cannot represent exactly", () => {
    const w = new BinaryWriter(16);
    expect(() => w.writeVarUint(-1)).toThrow(RangeError);
    expect(() => w.writeVarUint(1.5)).toThrow(RangeError);
    expect(() => w.writeVarUint(2 ** 53)).toThrow(RangeError);
    expect(() => w.writeVarInt(2 ** 52)).toThrow(RangeError);
  });

  test("a truncated varint is an error, not garbage", () => {
    const r = new BinaryReader(Uint8Array.from([0x80, 0x80]));
    expect(() => r.readVarUint()).toThrow(RangeError);
  });
});
