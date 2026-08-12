import { PlayerPattern } from "./Schemas";

/**
 * Header sizes in bytes, per pattern format version.
 *
 * v0: [version][scale:3 | width_lo:5][width_hi:2 | height:6]
 *     Width is allocated 7 bits (max 129) and height only 6 (max 65).
 *     Both metadata bytes are fully packed, so the format cannot be
 *     extended in place.
 *
 * v1: [version][scale:3 | width_hi:1 | height_hi:1 | reserved:3]
 *     [width_lo:8][height_lo:8]
 *     Width and height each get 9 bits (max 513). Three bits remain
 *     reserved for future use and must be zero.
 */
const HEADER_BYTES_V0 = 3;
const HEADER_BYTES_V1 = 4;

/**
 * Maximum canvas dimension accepted for v1 patterns.
 *
 * This is a policy limit, deliberately set below what the v1 header can
 * express (513). Raising it later is a one-line change that needs no
 * format version bump. It bounds the size of user-submitted pattern data
 * that reaches server-side validation.
 */
export const MAX_PATTERN_DIMENSION = 128;

/**
 * Maximum base64url length of a valid pattern string, derived from the v1
 * header size and MAX_PATTERN_DIMENSION. Used to bound user-submitted data
 * before it reaches the decoder.
 */
const MAX_PATTERN_BYTES =
  HEADER_BYTES_V1 + ((MAX_PATTERN_DIMENSION * MAX_PATTERN_DIMENSION + 7) >> 3);
export const MAX_PATTERN_DATA_LENGTH = ((MAX_PATTERN_BYTES * 4 + 2) / 3) | 0;

/**
 * Bytes reserved per player in the renderer's pattern-data texture (one row
 * each). Sized for the largest pattern the decoder accepts, so the CPU side
 * that fills the buffer and the GPU side that allocates the texture can't
 * drift from the format's limit.
 */
export const PATTERN_ROW_BYTES =
  (MAX_PATTERN_DIMENSION * MAX_PATTERN_DIMENSION + 7) >> 3;

export class PatternDecoder {
  private bytes: Uint8Array;
  private readonly headerBytes: number;

  readonly height: number;
  readonly width: number;
  readonly scale: number;

  constructor(
    pattern: PlayerPattern,
    base64urlDecode: (input: string) => Uint8Array,
  ) {
    ({
      height: this.height,
      width: this.width,
      scale: this.scale,
      headerBytes: this.headerBytes,
      bytes: this.bytes,
    } = decodePatternData(pattern.patternData, base64urlDecode));
  }

  isPrimary(x: number, y: number): boolean {
    const px = (x >> this.scale) % this.width;
    const py = (y >> this.scale) % this.height;
    const idx = py * this.width + px;
    const byteIndex = idx >> 3;
    const bitIndex = idx & 7;
    const byte = this.bytes[this.headerBytes + byteIndex];
    if (byte === undefined) throw new Error("Invalid pattern");

    return (byte & (1 << bitIndex)) === 0;
  }

  scaledHeight(): number {
    return this.height << this.scale;
  }

  scaledWidth(): number {
    return this.width << this.scale;
  }
}

export function decodePatternData(
  b64: string,
  base64urlDecode: (input: string) => Uint8Array,
): {
  height: number;
  width: number;
  scale: number;
  headerBytes: number;
  bytes: Uint8Array;
} {
  const bytes = base64urlDecode(b64);

  if (bytes.length < 1) {
    throw new Error("Pattern data is too short to contain required metadata.");
  }

  const version = bytes[0];

  let width: number;
  let height: number;
  let scale: number;
  let headerBytes: number;

  switch (version) {
    case 0: {
      headerBytes = HEADER_BYTES_V0;
      if (bytes.length < headerBytes) {
        throw new Error(
          "Pattern data is too short to contain required metadata.",
        );
      }

      const byte1 = bytes[1];
      const byte2 = bytes[2];

      scale = byte1 & 0x07;
      width = (((byte2 & 0x03) << 5) | ((byte1 >> 3) & 0x1f)) + 2;
      height = ((byte2 >> 2) & 0x3f) + 2;

      // v0 cannot express dimensions above 129x65, so a longer payload is
      // malformed. Previously bounded by the schema's max length, which v1
      // raises - keep v0 bounded here instead.
      if (bytes.length - headerBytes > 1049) {
        throw new Error("Pattern data is too long for the v0 format.");
      }
      break;
    }

    case 1: {
      headerBytes = HEADER_BYTES_V1;
      if (bytes.length < headerBytes) {
        throw new Error(
          "Pattern data is too short to contain required metadata.",
        );
      }

      const byte1 = bytes[1];

      // Bits 5-7 of byte1 are reserved. Reject when set so that they
      // remain available for future format changes.
      if (byte1 >> 5 !== 0) {
        throw new Error("Reserved bits set in pattern header.");
      }

      scale = byte1 & 0x07;
      width = ((((byte1 >> 3) & 0x01) << 8) | bytes[2]) + 2;
      height = ((((byte1 >> 4) & 0x01) << 8) | bytes[3]) + 2;

      if (width > MAX_PATTERN_DIMENSION || height > MAX_PATTERN_DIMENSION) {
        throw new Error(
          "Pattern dimensions exceed the maximum supported size.",
        );
      }
      break;
    }

    default:
      throw new Error(`Unrecognized pattern version ${version}.`);
  }

  const expectedBits = width * height;
  const expectedBytes = (expectedBits + 7) >> 3; // Equivalent to: ceil(expectedBits / 8);
  const payloadBytes = bytes.length - headerBytes;

  if (payloadBytes < expectedBytes) {
    throw new Error("Pattern data is too short for the specified dimensions.");
  }

  // v1 requires an exact payload length. v0 remains lenient so that
  // existing patterns continue to decode unchanged.
  if (version === 1 && payloadBytes !== expectedBytes) {
    throw new Error(
      "Pattern data length does not match the specified dimensions.",
    );
  }

  return { height, width, scale, headerBytes, bytes };
}
