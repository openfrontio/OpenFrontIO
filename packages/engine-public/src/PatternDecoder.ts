import { PlayerPattern } from "./Schemas";

export class PatternDecoder {
  private bytes: Uint8Array;

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
      bytes: this.bytes,
    } = decodePatternData(pattern.patternData, base64urlDecode));
  }

  isPrimary(x: number, y: number): boolean {
    const px = (x >> this.scale) % this.width;
    const py = (y >> this.scale) % this.height;
    const idx = py * this.width + px;
    const byteIndex = idx >> 3;
    const bitIndex = idx & 7;
    const byte = this.bytes[3 + byteIndex];
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
): { height: number; width: number; scale: number; bytes: Uint8Array } {
  const bytes = base64urlDecode(b64);

  if (bytes.length < 3) {
    throw new Error("Pattern data is too short to contain required metadata.");
  }

  const version = bytes[0];
  if (version !== 0) {
    throw new Error(`Unrecognized pattern version ${version}.`);
  }

  const byte1 = bytes[1];
  const byte2 = bytes[2];
  const scale = byte1 & 0x07;

  const width = (((byte2 & 0x03) << 5) | ((byte1 >> 3) & 0x1f)) + 2;
  const height = ((byte2 >> 2) & 0x3f) + 2;

  const expectedBits = width * height;
  const expectedBytes = (expectedBits + 7) >> 3; // Equivalent to: ceil(expectedBits / 8);
  if (bytes.length - 3 < expectedBytes) {
    throw new Error("Pattern data is too short for the specified dimensions.");
  }

  return { height, width, scale, bytes };
}
