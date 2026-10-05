import { decodePatternData } from "./CosmeticRefs";
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
