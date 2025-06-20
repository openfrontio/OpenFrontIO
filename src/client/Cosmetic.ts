export class TerritoryPatternStorage {
  private static readonly PATTERN_KEY = "territoryPattern";
  private static readonly PATTERN_BASE64_KEY = "territoryPatternBase64";

  static getSelectedPattern(): string | undefined {
    return localStorage.getItem(this.PATTERN_KEY) ?? undefined;
  }

  static setSelectedPattern(patternKey: string): void {
    localStorage.setItem(this.PATTERN_KEY, patternKey);
  }

  static getSelectedPatternBase64(): string | undefined {
    return localStorage.getItem(this.PATTERN_BASE64_KEY) ?? undefined;
  }

  static setSelectedPatternBase64(base64: string): void {
    localStorage.setItem(this.PATTERN_BASE64_KEY, base64);
  }
}
