import { z } from "zod";
import rawTerritoryPatterns from "../../resources/territory_patterns.json";

export const TerritoryPatternsSchema = z.record(
  z.string(),
  z.string().base64(),
);

export const territoryPatterns =
  TerritoryPatternsSchema.parse(rawTerritoryPatterns);

export class PatternDecoder {
  private bytes: Uint8Array;
  private tileWidth: number;
  private tileHeight: number;
  private scale: number;
  private dataStart: number;

  constructor(base64: string) {
    const byteString = atob(base64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }

    const version = bytes[0];
    if (version !== 1) {
      throw new Error("The pattern versions are different.");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset + 1, 6);
    this.tileWidth = view.getUint16(0, false);
    this.tileHeight = view.getUint16(2, false);
    this.scale = view.getUint16(4, false);
    this.dataStart = 7;
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
    const norm = (v: number, mod: number) => (v + mod) % mod;
    const px = norm((x / this.scale) | 0, this.tileWidth);
    const py = norm((y / this.scale) | 0, this.tileHeight);
    const idx = py * this.tileWidth + px;
    const byteIndex = idx >> 3;
    const bitIndex = idx & 7;
    const byte = this.bytes[this.dataStart + byteIndex];
    if (byte === undefined) throw new Error("Invalid pattern");
    return (byte & (1 << bitIndex)) !== 0;
  }
}

export class TerritoryPatternStorage {
  private static readonly KEY = "territoryPattern";
  private static readonly BASE64_KEY = "territoryPatternBase64";

  static getSelectedPattern(): string | undefined {
    return localStorage.getItem(TerritoryPatternStorage.KEY) ?? undefined;
  }

  static setSelectedPattern(patternKey: string): void {
    localStorage.setItem(TerritoryPatternStorage.KEY, patternKey);
  }

  static getSelectedPatternBase64(): string | undefined {
    return (
      localStorage.getItem(TerritoryPatternStorage.BASE64_KEY) ?? undefined
    );
  }

  static setSelectedPatternBase64(base64: string): void {
    localStorage.setItem(TerritoryPatternStorage.BASE64_KEY, base64);
  }
}
