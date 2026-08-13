import { base64url } from "jose";
import { DefaultPattern } from "../src/core/CosmeticSchemas";
import {
  decodePatternData,
  MAX_PATTERN_DIMENSION,
  PatternDecoder,
} from "../src/core/PatternDecoder";
import { PlayerPattern } from "../src/core/Schemas";

/** Bytes of pixel data a width x height pattern needs (1 bit per pixel). */
function payloadBytes(width: number, height: number): number {
  return (width * height + 7) >> 3;
}

/**
 * Build a v0 pattern string.
 *   byte0: version (0)
 *   byte1: scale(3) | width_lo(5)
 *   byte2: width_hi(2) | height(6)
 * Dimensions are stored as value - 2.
 */
function encodeV0(
  scale: number,
  width: number,
  height: number,
  payload?: Uint8Array,
): string {
  const w = width - 2;
  const h = height - 2;
  const bytes = new Uint8Array([
    0,
    ((w & 0x1f) << 3) | (scale & 0x07),
    ((h & 0x3f) << 2) | ((w >> 5) & 0x03),
    ...(payload ?? new Uint8Array(payloadBytes(width, height))),
  ]);
  return base64url.encode(bytes);
}

/**
 * Build a v1 pattern string.
 *   byte0: version (1)
 *   byte1: scale(3) | width_hi(1) | height_hi(1) | reserved(3)
 *   byte2: width_lo(8)
 *   byte3: height_lo(8)
 * Dimensions are stored as value - 2.
 */
function encodeV1(
  scale: number,
  width: number,
  height: number,
  opts: { reserved?: number; payload?: Uint8Array } = {},
): string {
  const w = width - 2;
  const h = height - 2;
  const bytes = new Uint8Array([
    1,
    (scale & 0x07) |
      (((w >> 8) & 0x01) << 3) |
      (((h >> 8) & 0x01) << 4) |
      ((opts.reserved ?? 0) << 5),
    w & 0xff,
    h & 0xff,
    ...(opts.payload ?? new Uint8Array(payloadBytes(width, height))),
  ]);
  return base64url.encode(bytes);
}

const decode = (b64: string) => decodePatternData(b64, base64url.decode);

const asPattern = (patternData: string): PlayerPattern => ({
  name: "test",
  patternData,
  colorPalette: undefined,
});

describe("decodePatternData v0", () => {
  test("decodes the default pattern as 2x2", () => {
    const result = decode(DefaultPattern.patternData);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.scale).toBe(0);
    expect(result.headerBytes).toBe(3);
  });

  test("round-trips dimensions and scale", () => {
    for (const [scale, width, height] of [
      [0, 2, 2],
      [0, 16, 16],
      [3, 32, 8],
      [7, 100, 40],
    ] as const) {
      const result = decode(encodeV0(scale, width, height));
      expect([result.scale, result.width, result.height]).toEqual([
        scale,
        width,
        height,
      ]);
    }
  });

  test("decodes at the v0 maximum of 129x65", () => {
    const result = decode(encodeV0(0, 129, 65));
    expect(result.width).toBe(129);
    expect(result.height).toBe(65);
  });

  test("accepts a payload longer than the dimensions require", () => {
    // v0 length checking is deliberately lenient — patterns already in the
    // store rely on this, so the behavior must not change.
    const padded = new Uint8Array(payloadBytes(16, 16) + 8);
    expect(() => decode(encodeV0(0, 16, 16, padded))).not.toThrow();
  });

  test("rejects a payload longer than the v0 format can produce", () => {
    // 129x65 needs 1049 bytes; nothing valid can exceed that.
    const oversized = new Uint8Array(1050);
    expect(() => decode(encodeV0(0, 129, 65, oversized))).toThrow(
      /too long for the v0 format/,
    );
  });

  test("rejects a payload shorter than the dimensions require", () => {
    const short = new Uint8Array(payloadBytes(16, 16) - 1);
    expect(() => decode(encodeV0(0, 16, 16, short))).toThrow(
      /too short for the specified dimensions/,
    );
  });
});

describe("decodePatternData v1", () => {
  test("round-trips dimensions and scale", () => {
    for (const [scale, width, height] of [
      [0, 2, 2],
      [0, 128, 128],
      [2, 128, 96],
      [5, 65, 128],
    ] as const) {
      const result = decode(encodeV1(scale, width, height));
      expect([result.scale, result.width, result.height]).toEqual([
        scale,
        width,
        height,
      ]);
      expect(result.headerBytes).toBe(4);
    }
  });

  test("rejects dimensions above the maximum", () => {
    const over = MAX_PATTERN_DIMENSION + 1;
    expect(() => decode(encodeV1(0, over, 2))).toThrow(
      /exceed the maximum supported size/,
    );
    expect(() => decode(encodeV1(0, 2, over))).toThrow(
      /exceed the maximum supported size/,
    );
  });

  test("rejects reserved bits being set", () => {
    expect(() => decode(encodeV1(0, 4, 4, { reserved: 1 }))).toThrow(
      /Reserved bits set/,
    );
  });

  test("requires an exact payload length", () => {
    const long = new Uint8Array(payloadBytes(16, 16) + 1);
    expect(() => decode(encodeV1(0, 16, 16, { payload: long }))).toThrow(
      /does not match the specified dimensions/,
    );

    const short = new Uint8Array(payloadBytes(16, 16) - 1);
    expect(() => decode(encodeV1(0, 16, 16, { payload: short }))).toThrow(
      /too short for the specified dimensions/,
    );
  });
});

describe("decodePatternData version handling", () => {
  test("rejects an unrecognized version", () => {
    const bytes = new Uint8Array([2, 0, 0, 0]);
    expect(() => decode(base64url.encode(bytes))).toThrow(
      /Unrecognized pattern version 2/,
    );
  });

  test("rejects data too short to hold a header", () => {
    expect(() => decode(base64url.encode(new Uint8Array([0, 0])))).toThrow(
      /too short to contain required metadata/,
    );
    expect(() => decode(base64url.encode(new Uint8Array([1, 0, 0])))).toThrow(
      /too short to contain required metadata/,
    );
  });
});

describe("PatternDecoder.isPrimary", () => {
  // Pixel lookups are offset by the header size. A v1 pattern read with the
  // v0 offset would return the wrong bit for every pixel, so this covers the
  // header-size handling as much as the bit arithmetic.
  function fourByFour(): Uint8Array {
    const payload = new Uint8Array(payloadBytes(4, 4));
    payload[0] = 0b0000_0011; // pixels (0,0) and (1,0) are secondary
    return payload;
  }

  function expectFourByFour(decoder: PatternDecoder): void {
    expect(decoder.isPrimary(0, 0)).toBe(false);
    expect(decoder.isPrimary(1, 0)).toBe(false);
    expect(decoder.isPrimary(2, 0)).toBe(true);
    expect(decoder.isPrimary(0, 1)).toBe(true);
  }

  test("reads pixel data at the correct offset for v0", () => {
    const pattern = asPattern(encodeV0(0, 4, 4, fourByFour()));
    expectFourByFour(new PatternDecoder(pattern, base64url.decode));
  });

  test("reads pixel data at the correct offset for v1", () => {
    const pattern = asPattern(encodeV1(0, 4, 4, { payload: fourByFour() }));
    expectFourByFour(new PatternDecoder(pattern, base64url.decode));
  });

  test("tiles by wrapping on both axes", () => {
    const payload = new Uint8Array(payloadBytes(4, 4));
    payload[0] = 0b0000_0001; // only pixel (0,0)
    const decoder = new PatternDecoder(
      asPattern(encodeV1(0, 4, 4, { payload })),
      base64url.decode,
    );
    expect(decoder.isPrimary(4, 0)).toBe(false);
    expect(decoder.isPrimary(0, 4)).toBe(false);
    expect(decoder.isPrimary(4, 4)).toBe(false);
  });

  test("scale shifts the sampled coordinate", () => {
    const payload = new Uint8Array(payloadBytes(4, 4));
    payload[0] = 0b0000_0001;
    const decoder = new PatternDecoder(
      asPattern(encodeV1(1, 4, 4, { payload })),
      base64url.decode,
    );
    // At scale 1 each pattern pixel covers a 2x2 block of tiles.
    expect(decoder.isPrimary(0, 0)).toBe(false);
    expect(decoder.isPrimary(1, 1)).toBe(false);
    expect(decoder.isPrimary(2, 0)).toBe(true);
  });

  test("reports scaled dimensions", () => {
    const decoder = new PatternDecoder(
      asPattern(encodeV1(2, 16, 8)),
      base64url.decode,
    );
    expect(decoder.scaledWidth()).toBe(64);
    expect(decoder.scaledHeight()).toBe(32);
  });
});
