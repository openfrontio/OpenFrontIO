import { base64url } from "jose";
import rawTerritoryPatterns from "../../resources/cosmetic/cosmetic.json" with { type: "json" };
import { CosmeticsSchema } from "./CosmeticSchemas";

export const territoryPatterns = CosmeticsSchema.parse(rawTerritoryPatterns);

export class PatternDecoder {
  private bytes: Uint8Array;
  private tileWidth: number;
  private tileHeight: number;
  private scale: number;
  private dataStart: number;

  constructor(base64: string) {
    const bytes = base64url.decode(base64);

    if (bytes.length < 3) {
      throw new Error(
        "Pattern data is too short to contain required metadata.",
      );
    }

    const version = bytes[0];
    if (version !== 1) {
      throw new Error(`Unrecognized pattern version ${version}.`);
    }

    const byte1 = bytes[1];
    const byte2 = bytes[2];
    this.scale = byte1 & 0x07;

    this.tileWidth = (((byte2 & 0x03) << 5) | ((byte1 >> 3) & 0x1f)) + 2;
    this.tileHeight = ((byte2 >> 2) & 0x3f) + 2;
    this.dataStart = 3;
    this.bytes = bytes;
  }

  getTileWidth(): number {
    return this.tileWidth;
  }

  getTileHeight(): number {
    return this.tileHeight;
  }

  getScale(): number {
    return this.scale;
  }

  isSet(x: number, y: number): boolean {
    const px = (x >> this.scale) % this.tileWidth;
    const py = (y >> this.scale) % this.tileHeight;
    const idx = py * this.tileWidth + px;
    const byteIndex = idx >> 3;
    const bitIndex = idx & 7;
    const byte = this.bytes[this.dataStart + byteIndex];
    if (byte === undefined) throw new Error("Invalid pattern");
    return (byte & (1 << bitIndex)) !== 0;
  }

  static isValid(base64: string): boolean {
    try {
      const bytes = base64url.decode(base64);
      if (bytes.length < 3) return false;

      const version = bytes[0];
      if (version !== 1) return false;

      const byte1 = bytes[1];
      const byte2 = bytes[2];
      const scale = byte1 & 0x07;

      if (scale < 1 || scale > 7) return false;

      return true;
    } catch {
      return false;
    }
  }
}
